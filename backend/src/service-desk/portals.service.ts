import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import {
  CustomFieldDefinition, CustomFieldType, IssueSource, IssueStatus, Portal, Prisma, ProjectType, UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { contains } from '../common/text-match';
import { IssuesService } from '../issues/issues.service';
import { CATEGORY_NAMES } from '../workflow/workflow.service';
import { PORTAL_FIELD_TYPES } from './service-desk.service';
import { CreatePortalDto, PortalRequestDto, UpdatePortalDto } from './dto/service-desk.dto';
import { freePortalSlug, RESERVED_PORTAL_SLUGS } from './defaults';

const USER_BRIEF = { select: { id: true, name: true, email: true } } as const;

const ADMIN_INCLUDE = {
  organizations: { include: { organization: { select: { id: true, name: true, _count: { select: { members: true } } } } } },
  customers: { include: { user: USER_BRIEF } },
  exclusions: { include: { user: USER_BRIEF } },
  requestTypes: { select: { requestTypeId: true } },
  _count: { select: { issues: true } },
} satisfies Prisma.PortalInclude;

/** A portal's look; null colour/logo means the default style. */
const brandingOf = (p: { welcome: string | null; color: string | null; logo: string | null }) =>
  ({ welcome: p.welcome, color: p.color, logo: p.logo });

/**
 * Customer portals (help centers). A service desk project can have several — e.g. one per client company —
 * each with its own link, branding, request types and allowed customers / organizations, all feeding the
 * same project and team. Customers only ever see their own requests, those added to them, and those
 * colleagues shared with their organization.
 */
@Injectable()
export class PortalsService implements OnModuleInit {
  private readonly logger = new Logger(PortalsService.name);

  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private issues: IssuesService,
  ) {}

  /**
   * Service desks from before a project could have several portals get one, carrying over their
   * help center settings, access lists and requests (its URL name is the project key, so links keep working).
   */
  async onModuleInit() {
    const desks = await this.prisma.project.findMany({
      where: { type: ProjectType.SERVICE_DESK, portals: { none: {} } },
      include: { customers: true, organizations: true },
    });
    for (const d of desks) {
      const portal = await this.prisma.portal.create({
        data: {
          projectId: d.id,
          slug: await freePortalSlug(this.prisma, d.key),
          name: d.name,
          open: d.portalOpen,
          welcome: d.portalWelcome,
          color: d.portalColor,
          logo: d.portalLogo,
          organizations: { create: d.organizations.map((o) => ({ organizationId: o.organizationId })) },
          customers: { create: d.customers.map((c) => ({ userId: c.userId })) },
        },
      });
      await this.prisma.issue.updateMany({ where: { projectId: d.id, portalId: null }, data: { portalId: portal.id } });
    }
    if (desks.length) this.logger.log(`Created portals for ${desks.length} service desk(s)`);

    // Requests raised through a project's help center before it had portals belong to its first portal.
    const firstPortals = await this.prisma.portal.findMany({
      distinct: ['projectId'],
      orderBy: [{ projectId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, projectId: true },
    });
    let filed = 0;
    for (const p of firstPortals) {
      const r = await this.prisma.issue.updateMany({
        where: { projectId: p.projectId, portalId: null, requestTypeId: { not: null } },
        data: { portalId: p.id },
      });
      filed += r.count;
    }
    if (filed) this.logger.log(`Filed ${filed} existing request(s) under their project's first portal`);
  }

  // ─── Administration (agents read, project admins change) ───────────────────

  async list(key: string) {
    const project = await this.desk(key);
    const portals = await this.prisma.portal.findMany({
      where: { projectId: project.id },
      include: ADMIN_INCLUDE,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return portals.map(adminView);
  }

  async create(key: string, dto: CreatePortalDto) {
    const project = await this.desk(key);
    const slug = this.checkSlug(dto.slug);
    const { _max } = await this.prisma.portal.aggregate({ where: { projectId: project.id }, _max: { position: true } });
    const portal = await this.uniqueSlug(slug, () => this.prisma.portal.create({
      // New portals are for specific customers: closed until organizations or customers are added.
      data: { projectId: project.id, slug, name: dto.name.trim(), open: false, position: (_max.position ?? -1) + 1 },
      include: ADMIN_INCLUDE,
    }));
    return adminView(portal);
  }

  async update(key: string, id: string, dto: UpdatePortalDto) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    const slug = dto.slug === undefined ? undefined : this.checkSlug(dto.slug);
    if (dto.requestTypeIds) {
      const found = await this.prisma.requestType.count({ where: { id: { in: dto.requestTypeIds }, projectId: project.id } });
      if (found !== new Set(dto.requestTypeIds).size) throw new BadRequestException('Request types must belong to this service desk');
    }
    const portal = await this.uniqueSlug(slug ?? '', () => this.prisma.$transaction(async (tx) => {
      if (dto.requestTypeIds) {
        await tx.portalRequestType.deleteMany({ where: { portalId: id } });
        await tx.portalRequestType.createMany({ data: [...new Set(dto.requestTypeIds)].map((requestTypeId) => ({ portalId: id, requestTypeId })) });
      }
      return tx.portal.update({
        where: { id },
        data: {
          slug,
          name: dto.name?.trim(),
          open: dto.open,
          welcome: dto.welcome === undefined ? undefined : dto.welcome.trim() || null,
          color: dto.color === undefined ? undefined : dto.color || null,
          logo: dto.logo === undefined ? undefined : dto.logo || null,
        },
        include: ADMIN_INCLUDE,
      });
    }));
    return adminView(portal);
  }

  /** Its requests stay in the project and move to the project's first remaining portal. */
  async remove(key: string, id: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    const next = await this.prisma.portal.findFirst({
      where: { projectId: project.id, id: { not: id } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    if (!next) throw new BadRequestException('A service desk needs at least one portal');
    await this.prisma.$transaction([
      this.prisma.issue.updateMany({ where: { portalId: id }, data: { portalId: next.id } }),
      this.prisma.portal.delete({ where: { id } }),
    ]);
    return { deleted: true, movedTo: { id: next.id, name: next.name } };
  }

  async addOrganization(key: string, id: string, organizationId: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    if (!(await this.prisma.organization.findUnique({ where: { id: organizationId } }))) throw new NotFoundException('Organization not found');
    await this.prisma.portalOrganization.upsert({
      where: { portalId_organizationId: { portalId: id, organizationId } },
      create: { portalId: id, organizationId },
      update: {},
    });
    return this.adminPortal(id);
  }

  async removeOrganization(key: string, id: string, organizationId: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    await this.prisma.portalOrganization.deleteMany({ where: { portalId: id, organizationId } });
    return this.adminPortal(id);
  }

  async addCustomer(key: string, id: string, userId: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException('Only customer accounts can be added. Staff use portals through their project access.');
    }
    await this.prisma.$transaction([
      this.prisma.portalCustomer.upsert({
        where: { portalId_userId: { portalId: id, userId } },
        create: { portalId: id, userId },
        update: {},
      }),
      this.prisma.portalExclusion.deleteMany({ where: { portalId: id, userId } }),
    ]);
    return this.adminPortal(id);
  }

  async removeCustomer(key: string, id: string, userId: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    await this.prisma.portalCustomer.deleteMany({ where: { portalId: id, userId } });
    return this.adminPortal(id);
  }

  /** Lets an excluded customer back in (through the portal being open or their organization). */
  async removeExclusion(key: string, id: string, userId: string) {
    const project = await this.desk(key);
    await this.portalOf(project.id, id);
    await this.prisma.portalExclusion.deleteMany({ where: { portalId: id, userId } });
    return this.adminPortal(id);
  }

  // ─── One customer's portals (global admins, from the People page) ──────────

  /** Every service desk portal, with whether and how this customer can use it. */
  async customerPortals(userId: string) {
    await this.customer(userId);
    const [portals, orgIds] = await Promise.all([
      this.prisma.portal.findMany({
        where: { project: { type: ProjectType.SERVICE_DESK } },
        include: {
          project: { select: { key: true, name: true } },
          organizations: { include: { organization: { select: { id: true, name: true } } } },
          customers: { where: { userId }, select: { userId: true } },
          exclusions: { where: { userId }, select: { userId: true } },
        },
        orderBy: [{ project: { name: 'asc' } }, { position: 'asc' }, { name: 'asc' }],
      }),
      this.myOrganizationIds(userId),
    ]);
    return portals.map((p) => {
      const viaOrganizations = p.organizations
        .filter((o) => orgIds.includes(o.organizationId))
        .map((o) => o.organization)
        .sort((a, b) => a.name.localeCompare(b.name));
      const direct = p.customers.length > 0;
      const excluded = p.exclusions.length > 0;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        project: p.project,
        open: p.open,
        direct,
        viaOrganizations,
        excluded,
        canUse: !excluded && (p.open || direct || viaOrganizations.length > 0),
      };
    });
  }

  /** Gives the customer the portal: lifts an exclusion, and lists them on it when nothing else would let them in. */
  async allowCustomerPortal(userId: string, portalId: string) {
    await this.customer(userId);
    const portal = await this.prisma.portal.findUnique({ where: { id: portalId } });
    if (!portal) throw new NotFoundException('Portal not found');
    await this.prisma.portalExclusion.deleteMany({ where: { portalId, userId } });
    if (!(await this.customerCanUse(userId, portal))) {
      await this.prisma.portalCustomer.create({ data: { portalId, userId } });
    }
    return this.customerPortals(userId);
  }

  /** Takes the portal away: unlists them, and excludes them if it's open or serves one of their organizations. */
  async removeCustomerPortal(userId: string, portalId: string) {
    await this.customer(userId);
    const portal = await this.prisma.portal.findUnique({ where: { id: portalId } });
    if (!portal) throw new NotFoundException('Portal not found');
    await this.prisma.portalCustomer.deleteMany({ where: { portalId, userId } });
    if (await this.customerCanUse(userId, portal)) {
      await this.prisma.portalExclusion.create({ data: { portalId, userId } });
    }
    return this.customerPortals(userId);
  }

  private async customer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CUSTOMER) throw new BadRequestException('Only customers have portals. Staff use them through their project access.');
  }

  /** Agents share a request with one of the organizations the project's portals serve, or make it private (null). */
  async setRequestOrganization(idOrKey: string, organizationId: string | null, userId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      include: { project: { select: { type: true } } },
    });
    if (!issue || issue.project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException('Request not found');
    if (organizationId && !(await this.prisma.portalOrganization.findFirst({
      where: { organizationId, portal: { projectId: issue.projectId } },
    }))) throw new BadRequestException('Share requests only with organizations this service desk\'s portals serve');
    await this.recordOrganization(issue.id, issue.organizationId, organizationId, userId);
    return { organization: organizationId ? await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }) : null };
  }

  // ─── The help center (customers and staff) ─────────────────────────────────

  /** Portals this person can use. */
  async mine(user: AuthUser) {
    const where: Prisma.PortalWhereInput = { project: { type: ProjectType.SERVICE_DESK } };
    if (user.role === UserRole.CUSTOMER) {
      where.OR = [
        { open: true },
        { customers: { some: { userId: user.id } } },
        { organizations: { some: { organization: { members: { some: { userId: user.id } } } } } },
      ];
      where.exclusions = { none: { userId: user.id } };
    } else {
      const ids = await this.access.browsableProjectIds(user);
      if (ids !== null) where.projectId = { in: ids };
    }
    const portals = await this.prisma.portal.findMany({
      where,
      include: { project: { select: { key: true, name: true, description: true } } },
      orderBy: [{ name: 'asc' }],
    });
    return portals.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.project.description,
      // Staff see which project a portal feeds; customers don't need to.
      project: user.role === UserRole.CUSTOMER ? null : { key: p.project.key, name: p.project.name },
      branding: brandingOf(p),
    }));
  }

  async portal(slug: string, user: AuthUser) {
    const portal = await this.usable(slug, user);
    const [types, shareWith, canRaiseOnBehalf] = await Promise.all([
      this.offeredTypes(portal),
      this.shareOptions(portal.id, user.id),
      user.role !== UserRole.CUSTOMER ? this.access.can(user, portal.projectId, 'edit') : Promise.resolve(false),
    ]);
    return {
      slug: portal.slug,
      name: portal.name,
      description: portal.project.description,
      branding: brandingOf(portal),
      // The raiser's organizations this portal serves: they may share the request with one of them.
      shareWith,
      // Agents can raise a request for a customer (e.g. one who phoned in).
      canRaiseOnBehalf,
      requestTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        fields: t.fields
          .filter((f) => PORTAL_FIELD_TYPES.includes(f.field.type))
          .map((f) => ({ key: f.field.key, name: f.field.name, type: f.field.type, options: parseOptions(f.field.options), required: f.required })),
      })),
    };
  }

  async raise(slug: string, dto: PortalRequestDto, user: AuthUser) {
    const portal = await this.usable(slug, user);
    const type = (await this.offeredTypes(portal)).find((t) => t.id === dto.requestTypeId);
    if (!type) throw new BadRequestException('Choose what you need help with');

    let reporterId = user.id;
    if (dto.onBehalfOfId && dto.onBehalfOfId !== user.id) {
      if (user.role === UserRole.CUSTOMER) throw new BadRequestException('You can only raise requests for yourself');
      await this.access.require(user, portal.projectId, 'edit');
      const customer = await this.prisma.user.findUnique({ where: { id: dto.onBehalfOfId }, select: { id: true } });
      if (!customer) throw new NotFoundException('Customer not found');
      reporterId = customer.id;
    }

    const customFields: Record<string, string> = {};
    for (const f of type.fields) {
      if (!PORTAL_FIELD_TYPES.includes(f.field.type)) continue;
      const value = String(dto.fields?.[f.field.key] ?? '').trim();
      if (!value) {
        if (f.required) throw new BadRequestException(`${f.field.name} is required`);
        continue;
      }
      customFields[f.field.key] = checkFieldValue(f.field, value);
    }

    // Sharing: an explicit organization must be one of the requester's that this portal serves;
    // otherwise (unless they opted out) share with the first such organization.
    const options = await this.shareOptions(portal.id, reporterId);
    let organizationId: string | null = null;
    if (dto.organizationId) {
      if (!options.some((o) => o.id === dto.organizationId)) throw new BadRequestException('You can only share with your own organization');
      organizationId = dto.organizationId;
    } else if (dto.shareWithOrganization !== false) {
      organizationId = options[0]?.id ?? null;
    }

    const issue = await this.issues.create(
      { type: type.issueType, summary: dto.summary.trim(), description: dto.description, projectKey: portal.project.key, customFields },
      user,
      undefined,
      { requestTypeId: type.id, reporterId, organizationId, portalId: portal.id, source: IssueSource.PORTAL },
    );
    return { key: issue.key };
  }

  /** Requests the user raised, was added to, or (customers) that colleagues shared with their organizations. */
  async myRequests(user: AuthUser, opts: { status?: string; q?: string }) {
    const mine: Prisma.IssueWhereInput[] = [{ reporterId: user.id }];
    if (user.role === UserRole.CUSTOMER) {
      mine.push({ watchers: { some: { userId: user.id } } });
      const orgs = await this.myOrganizationIds(user.id);
      if (orgs.length) mine.push({ organizationId: { in: orgs } });
    }
    const where: Prisma.IssueWhereInput = { project: { type: ProjectType.SERVICE_DESK }, OR: mine };
    if (opts.status === 'open') where.status = { not: IssueStatus.CLOSED };
    if (opts.status === 'closed') where.status = IssueStatus.CLOSED;
    const q = opts.q?.trim();
    if (q) where.AND = [{ OR: [{ summary: contains(q) }, { key: contains(q.toUpperCase()) }] }];
    const issues = await this.prisma.issue.findMany({
      where,
      include: {
        workflowStatus: { select: { name: true, category: true } },
        requestType: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
        portal: { select: { slug: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return issues.map((i) => ({
      key: i.key,
      summary: i.summary,
      status: { name: i.workflowStatus?.name ?? CATEGORY_NAMES[i.status], category: i.status },
      requestType: i.requestType,
      portal: i.portal,
      reporter: i.reporter,
      organization: i.organization,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));
  }

  /** The customer's view of a request: public replies only, never internal notes or SLAs. */
  async request(key: string, user: AuthUser) {
    const issue = await this.prisma.issue.findUnique({
      where: { key: key.toUpperCase() },
      include: {
        project: { select: { id: true, type: true } },
        portal: { select: { id: true, slug: true, name: true, welcome: true, color: true, logo: true } },
        workflowStatus: { select: { name: true, category: true } },
        requestType: { select: { id: true, name: true, fields: { include: { field: true }, orderBy: { position: 'asc' } } } },
        reporter: { select: { id: true, name: true, role: true } },
        organization: { select: { id: true, name: true } },
        watchers: { include: { user: { select: { id: true, name: true, role: true } } } },
        comments: {
          where: { internal: false },
          include: { author: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
        customFieldValues: { select: { fieldId: true, value: true } },
      },
    });
    if (!issue || !(await this.canView(user, issue))) throw new NotFoundException('Request not found');

    const values = new Map(issue.customFieldValues.map((v) => [v.fieldId, v.value]));
    const isAgent = (u: { id: string; role: UserRole }) => u.role !== UserRole.CUSTOMER && u.id !== issue.reporterId;
    // Only the requester decides who else in their company sees it.
    const shareWith = issue.reporterId === user.id ? await this.requestShareOptions(issue, user.id) : null;
    return {
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      description: issue.description,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolution: issue.resolution,
      status: { name: issue.workflowStatus?.name ?? CATEGORY_NAMES[issue.status], category: issue.status },
      portal: issue.portal ? { slug: issue.portal.slug, name: issue.portal.name, branding: brandingOf(issue.portal) } : null,
      requestType: issue.requestType ? { id: issue.requestType.id, name: issue.requestType.name } : null,
      reporter: issue.reporter ? { id: issue.reporter.id, name: issue.reporter.name } : null,
      organization: issue.organization,
      shareWith,
      participants: issue.watchers
        .filter((w) => w.user.role === UserRole.CUSTOMER && w.userId !== issue.reporterId)
        .map((w) => ({ id: w.user.id, name: w.user.name })),
      fields: (issue.requestType?.fields ?? [])
        .filter((f) => values.has(f.fieldId))
        .map((f) => ({ name: f.field.name, value: values.get(f.fieldId)! })),
      comments: issue.comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        author: { id: c.author.id, name: c.author.name, agent: isAgent(c.author) },
      })),
    };
  }

  /** The requester changes who a request is shared with: one of their organizations the portal serves, or nobody. */
  async share(key: string, user: AuthUser, organizationId: string | null) {
    const issue = await this.prisma.issue.findUnique({ where: { key: key.toUpperCase() }, include: { project: { select: { type: true } } } });
    if (!issue || issue.project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException('Request not found');
    if (issue.reporterId !== user.id) throw new ForbiddenException('Only the person who raised a request can change who it is shared with');
    if (organizationId && !(await this.requestShareOptions(issue, user.id)).some((o) => o.id === organizationId)) {
      throw new BadRequestException('You can only share with your own organization');
    }
    await this.recordOrganization(issue.id, issue.organizationId, organizationId, user.id);
    return this.request(key, user);
  }

  /**
   * A reply from the help center. When the customer answers a request that was waiting for them,
   * it goes back to the agents (and the SLA clock resumes).
   */
  async comment(key: string, user: AuthUser, body: string) {
    await this.reply(key, user, body);
    return this.request(key, user);
  }

  /** Adds the reply (see comment) and returns it. `emailed`: see IssuesService.addComment. */
  async reply(key: string, user: AuthUser, body: string, opts: { emailed?: string[] } = {}) {
    const issue = await this.prisma.issue.findUnique({
      where: { key: key.toUpperCase() },
      include: {
        project: { select: { type: true } },
        watchers: { select: { userId: true } },
        workflowStatus: { select: { pausesSla: true, category: true } },
      },
    });
    if (!issue || !(await this.canView(user, issue))) throw new NotFoundException('Request not found');
    const comment = await this.issues.addComment(issue.id, user, body, { emailed: opts.emailed });

    const fromCustomer = user.role === UserRole.CUSTOMER || user.id === issue.reporterId;
    if (fromCustomer && issue.statusId && issue.workflowStatus?.pausesSla && issue.workflowStatus.category !== IssueStatus.CLOSED) {
      const back = await this.prisma.workflowTransition.findMany({
        where: { fromStatusId: issue.statusId, toStatus: { pausesSla: false, category: { not: IssueStatus.CLOSED } } },
        include: { toStatus: true },
      });
      // Prefer the "waiting for support" kind of status over "in progress".
      const target = back.map((t) => t.toStatus)
        .sort((a, b) => Number(a.category !== IssueStatus.TO_DO) - Number(b.category !== IssueStatus.TO_DO) || a.position - b.position)[0];
      if (target) await this.issues.transition(issue.id, { statusId: target.id }, user.id);
    }
    return comment;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async desk(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException(`${key.toUpperCase()} is not a service desk`);
    return project;
  }

  private async portalOf(projectId: string, id: string) {
    const portal = await this.prisma.portal.findFirst({ where: { id, projectId } });
    if (!portal) throw new NotFoundException('Portal not found');
    return portal;
  }

  private async adminPortal(id: string) {
    return adminView(await this.prisma.portal.findUniqueOrThrow({ where: { id }, include: ADMIN_INCLUDE }));
  }

  /**
   * Customers need an open portal, or to be listed (themselves or through an organization), and not to be excluded
   * from it; staff need access to its project.
   */
  async canUse(user: AuthUser, portal: Portal) {
    if (user.role !== UserRole.CUSTOMER) return this.access.can(user, portal.projectId, 'browse');
    return this.customerCanUse(user.id, portal);
  }

  private async customerCanUse(userId: string, portal: Portal) {
    if (await this.prisma.portalExclusion.findUnique({ where: { portalId_userId: { portalId: portal.id, userId } } })) return false;
    if (portal.open) return true;
    const [listed, viaOrganization] = await Promise.all([
      this.prisma.portalCustomer.findUnique({ where: { portalId_userId: { portalId: portal.id, userId } } }),
      this.prisma.portalOrganization.findFirst({ where: { portalId: portal.id, organization: { members: { some: { userId } } } } }),
    ]);
    return !!(listed || viaOrganization);
  }

  /** 404 rather than 403, so customers can't discover portals that aren't theirs. */
  private async usable(slug: string, user: AuthUser) {
    const portal = await this.prisma.portal.findUnique({
      where: { slug: slug.toLowerCase() },
      include: { project: { select: { key: true, type: true, description: true } } },
    });
    if (!portal || portal.project.type !== ProjectType.SERVICE_DESK || !(await this.canUse(user, portal))) {
      throw new NotFoundException('Help center not found');
    }
    return portal;
  }

  /** The request types a portal offers: the ones it lists, or all of its project's. */
  async offeredTypes(portal: { id: string; projectId: string }) {
    const listed = await this.prisma.portalRequestType.findMany({ where: { portalId: portal.id }, select: { requestTypeId: true } });
    return this.prisma.requestType.findMany({
      where: { projectId: portal.projectId, ...(listed.length ? { id: { in: listed.map((l) => l.requestTypeId) } } : {}) },
      include: { fields: { include: { field: true }, orderBy: { position: 'asc' } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  /** Organizations a request raised by this person through this portal can be shared with: theirs that it serves. */
  shareOptions(portalId: string, userId: string) {
    return this.prisma.organization.findMany({
      where: { members: { some: { userId } }, portals: { some: { portalId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** For an existing request: its portal's organizations, or (no portal) those of any portal of its project. */
  private requestShareOptions(issue: { portalId: string | null; projectId: string }, userId: string) {
    if (issue.portalId) return this.shareOptions(issue.portalId, userId);
    return this.prisma.organization.findMany({
      where: { members: { some: { userId } }, portals: { some: { portal: { projectId: issue.projectId } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  private async myOrganizationIds(userId: string) {
    return (await this.prisma.organizationMember.findMany({ where: { userId }, select: { organizationId: true } })).map((m) => m.organizationId);
  }

  /**
   * The reporter, participants and (when it's shared) members of its organization see a request;
   * so do staff who can browse its project. Nobody from another company does.
   */
  private async canView(
    user: AuthUser,
    issue: {
      projectId: string; reporterId: string | null; organizationId: string | null;
      project: { type: ProjectType }; watchers: { userId: string }[];
    },
  ) {
    if (issue.project.type !== ProjectType.SERVICE_DESK) return false;
    if (issue.reporterId === user.id || issue.watchers.some((w) => w.userId === user.id)) return true;
    if (issue.organizationId && (await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: issue.organizationId, userId: user.id } },
    }))) return true;
    return user.role !== UserRole.CUSTOMER && this.access.can(user, issue.projectId, 'browse');
  }

  /** Change who a request is shared with, keeping a record in its history. */
  private async recordOrganization(issueId: string, fromId: string | null, toId: string | null, userId?: string) {
    if (fromId === toId) return;
    const names = new Map((await this.prisma.organization.findMany({
      where: { id: { in: [fromId, toId].filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    })).map((o) => [o.id, o.name]));
    await this.prisma.$transaction([
      this.prisma.issue.update({ where: { id: issueId }, data: { organizationId: toId } }),
      this.prisma.issueHistory.create({
        data: { issueId, userId: userId ?? null, field: 'organization', fromValue: fromId ? names.get(fromId) ?? null : null, toValue: toId ? names.get(toId) ?? null : null },
      }),
    ]);
  }

  private checkSlug(raw: string) {
    const slug = raw.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 40) {
      throw new BadRequestException('The link name must be 2–40 lowercase letters, digits or hyphens, e.g. acme-support');
    }
    if (RESERVED_PORTAL_SLUGS.has(slug)) throw new BadRequestException(`"${slug}" is reserved; choose another link name`);
    return slug;
  }

  private async uniqueSlug<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Another portal already uses the link /portal/${slug}`);
      }
      throw e;
    }
  }
}

function adminView(p: Prisma.PortalGetPayload<{ include: typeof ADMIN_INCLUDE }>) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    open: p.open,
    branding: brandingOf(p),
    organizations: p.organizations
      .map((o) => ({ id: o.organization.id, name: o.organization.name, members: o.organization._count.members }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    customers: p.customers.map((c) => c.user).sort((a, b) => a.name.localeCompare(b.name)),
    /** Kept off it although it's open or serves their organization */
    excluded: p.exclusions.map((c) => c.user).sort((a, b) => a.name.localeCompare(b.name)),
    /** Empty: every request type of the project */
    requestTypeIds: p.requestTypes.map((r) => r.requestTypeId),
    requests: p._count.issues,
  };
}

function parseOptions(options: string | null): string[] {
  if (!options) return [];
  try {
    const parsed = JSON.parse(options);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function checkFieldValue(field: CustomFieldDefinition, value: string) {
  switch (field.type) {
    case CustomFieldType.NUMBER:
      if (Number.isNaN(Number(value))) throw new BadRequestException(`${field.name} must be a number`);
      return value;
    case CustomFieldType.DATE:
      if (Number.isNaN(Date.parse(value))) throw new BadRequestException(`${field.name} must be a date`);
      return value;
    case CustomFieldType.SELECT:
      if (!parseOptions(field.options).includes(value)) throw new BadRequestException(`Choose one of the options for ${field.name}`);
      return value;
    default:
      if (value.length > 2000) throw new BadRequestException(`${field.name} is too long`);
      return value;
  }
}
