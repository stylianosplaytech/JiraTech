import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  CustomFieldDefinition, CustomFieldType, IssueStatus, Prisma, Priority, Project, ProjectType, UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../common/auth-user';
import { computeSla, Sla, SlaGoals } from '../common/sla';
import { contains } from '../common/text-match';
import { IssuesService } from '../issues/issues.service';
import { CATEGORY_NAMES } from '../workflow/workflow.service';
import { compileJql, JqlError } from '../search/jql';
import { compareRows } from '../search/search.service';
import {
  PortalRequestDto, PortalSettingsDto, QueueDto, RequestTypeDto, SlaTargetDto, UpdateQueueDto, UpdateRequestTypeDto,
} from './dto/service-desk.dto';

const USER_BRIEF = { select: { id: true, name: true, email: true } } as const;
/** Field types a customer can fill in on the portal. */
const PORTAL_FIELD_TYPES: CustomFieldType[] = [CustomFieldType.TEXT, CustomFieldType.NUMBER, CustomFieldType.SELECT, CustomFieldType.DATE];
/** Queues are sorted in memory (by SLA); larger queues show their first rows only. */
const QUEUE_LIMIT = 1000;

const QUEUE_INCLUDE = {
  workflowStatus: { select: { id: true, name: true, category: true } },
  assignee: USER_BRIEF,
  reporter: USER_BRIEF,
  requestType: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.IssueInclude;

type SlaIssue = Parameters<typeof computeSla>[0] & { projectId: string; priority: Priority };

@Injectable()
export class ServiceDeskService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private issues: IssuesService,
  ) {}

  // ─── Configuration (agents read, project admins change) ────────────────────

  async settings(key: string) {
    const project = await this.desk(key);
    const [requestTypes, targets, queues] = await Promise.all([
      this.requestTypes(project.id),
      this.prisma.slaTarget.findMany({ where: { projectId: project.id } }),
      this.prisma.queue.findMany({ where: { projectId: project.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    ]);
    const byPriority = new Map(targets.map((t) => [t.priority, t]));
    return {
      project: { id: project.id, key: project.key, name: project.name, portalOpen: project.portalOpen },
      requestTypes,
      slaTargets: Object.values(Priority).map((priority) => ({
        priority,
        firstResponseMinutes: byPriority.get(priority)?.firstResponseMinutes ?? null,
        resolutionMinutes: byPriority.get(priority)?.resolutionMinutes ?? null,
      })),
      queues,
    };
  }

  async createRequestType(key: string, dto: RequestTypeDto) {
    const project = await this.desk(key);
    await this.assertFields(project.id, dto.fields);
    const { _max } = await this.prisma.requestType.aggregate({ where: { projectId: project.id }, _max: { position: true } });
    return this.unique(`A request type called ${dto.name.trim()} already exists`, () => this.prisma.requestType.create({
      data: {
        projectId: project.id,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        issueType: dto.issueType,
        position: (_max.position ?? -1) + 1,
        fields: dto.fields?.length
          ? { create: dto.fields.map((f, position) => ({ fieldId: f.fieldId, required: !!f.required, position })) }
          : undefined,
      },
    }));
  }

  async updateRequestType(key: string, id: string, dto: UpdateRequestTypeDto) {
    const project = await this.desk(key);
    await this.requestTypeOf(project.id, id);
    if (dto.fields) await this.assertFields(project.id, dto.fields);
    await this.unique(`A request type called ${dto.name?.trim()} already exists`, () => this.prisma.$transaction(async (tx) => {
      await tx.requestType.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: dto.description === undefined ? undefined : dto.description.trim() || null,
          issueType: dto.issueType,
        },
      });
      if (dto.fields) {
        await tx.requestTypeField.deleteMany({ where: { requestTypeId: id } });
        await tx.requestTypeField.createMany({
          data: dto.fields.map((f, position) => ({ requestTypeId: id, fieldId: f.fieldId, required: !!f.required, position })),
        });
      }
    }));
    return (await this.requestTypes(project.id)).find((t) => t.id === id);
  }

  /** Existing requests keep their content; they just no longer have a request type. */
  async deleteRequestType(key: string, id: string) {
    const project = await this.desk(key);
    await this.requestTypeOf(project.id, id);
    await this.prisma.requestType.delete({ where: { id } });
    return { deleted: true };
  }

  async setSlaTargets(key: string, targets: SlaTargetDto[]) {
    const project = await this.desk(key);
    await this.prisma.$transaction(targets.map((t) => this.prisma.slaTarget.upsert({
      where: { projectId_priority: { projectId: project.id, priority: t.priority } },
      create: { projectId: project.id, priority: t.priority, firstResponseMinutes: t.firstResponseMinutes ?? null, resolutionMinutes: t.resolutionMinutes ?? null },
      update: { firstResponseMinutes: t.firstResponseMinutes ?? null, resolutionMinutes: t.resolutionMinutes ?? null },
    })));
    return (await this.settings(key)).slaTargets;
  }

  async createQueue(key: string, dto: QueueDto, user: AuthUser) {
    const project = await this.desk(key);
    this.compile(dto.jql, user);
    const { _max } = await this.prisma.queue.aggregate({ where: { projectId: project.id }, _max: { position: true } });
    return this.unique(`A queue called ${dto.name.trim()} already exists`, () => this.prisma.queue.create({
      data: { projectId: project.id, name: dto.name.trim(), jql: dto.jql.trim(), position: (_max.position ?? -1) + 1 },
    }));
  }

  async updateQueue(key: string, id: string, dto: UpdateQueueDto, user: AuthUser) {
    const project = await this.desk(key);
    await this.queueOf(project.id, id);
    if (dto.jql !== undefined) this.compile(dto.jql, user);
    return this.unique(`A queue called ${dto.name?.trim()} already exists`, () => this.prisma.queue.update({
      where: { id },
      data: { name: dto.name?.trim(), jql: dto.jql?.trim() },
    }));
  }

  async deleteQueue(key: string, id: string) {
    const project = await this.desk(key);
    await this.queueOf(project.id, id);
    await this.prisma.queue.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Portal access ─────────────────────────────────────────────────────────

  /** Who can use the help center, and how it looks. */
  async customers(key: string) {
    const project = await this.desk(key);
    const [customers, organizations] = await Promise.all([
      this.prisma.projectCustomer.findMany({
        where: { projectId: project.id },
        include: { user: USER_BRIEF },
        orderBy: { user: { name: 'asc' } },
      }),
      this.prisma.projectOrganization.findMany({
        where: { projectId: project.id },
        include: { organization: { select: { id: true, name: true, _count: { select: { members: true } } } } },
        orderBy: { organization: { name: 'asc' } },
      }),
    ]);
    return {
      portalOpen: project.portalOpen,
      customers: customers.map((c) => c.user),
      organizations: organizations.map((o) => ({ id: o.organization.id, name: o.organization.name, members: o.organization._count.members })),
      branding: brandingOf(project),
    };
  }

  async updatePortal(key: string, dto: PortalSettingsDto) {
    const project = await this.desk(key);
    await this.prisma.project.update({
      where: { id: project.id },
      data: {
        portalOpen: dto.portalOpen,
        portalWelcome: dto.welcome === undefined ? undefined : dto.welcome.trim() || null,
        portalColor: dto.color === undefined ? undefined : dto.color || null,
        portalLogo: dto.logo === undefined ? undefined : dto.logo || null,
      },
    });
    return this.customers(key);
  }

  async addOrganization(key: string, organizationId: string) {
    const project = await this.desk(key);
    if (!(await this.prisma.organization.findUnique({ where: { id: organizationId } }))) throw new NotFoundException('Organization not found');
    await this.prisma.projectOrganization.upsert({
      where: { projectId_organizationId: { projectId: project.id, organizationId } },
      create: { projectId: project.id, organizationId },
      update: {},
    });
    return this.customers(key);
  }

  async removeOrganization(key: string, organizationId: string) {
    const project = await this.desk(key);
    await this.prisma.projectOrganization.deleteMany({ where: { projectId: project.id, organizationId } });
    return this.customers(key);
  }

  /** Agents share a request with one of the organizations the desk serves, or make it private (null). */
  async setRequestOrganization(idOrKey: string, organizationId: string | null, userId: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      include: { project: { select: { type: true } } },
    });
    if (!issue || issue.project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException('Request not found');
    if (organizationId && !(await this.prisma.projectOrganization.findUnique({
      where: { projectId_organizationId: { projectId: issue.projectId, organizationId } },
    }))) throw new BadRequestException('Share requests only with organizations this service desk serves');
    await this.recordOrganization(issue.id, issue.organizationId, organizationId, userId);
    return this.requestInfo(issue.id);
  }

  async addCustomer(key: string, userId: string) {
    const project = await this.desk(key);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== UserRole.CUSTOMER) {
      throw new BadRequestException('Only customer accounts can be added. Staff raise requests through their project access.');
    }
    await this.prisma.projectCustomer.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      create: { projectId: project.id, userId },
      update: {},
    });
    return this.customers(key);
  }

  async removeCustomer(key: string, userId: string) {
    const project = await this.desk(key);
    await this.prisma.projectCustomer.deleteMany({ where: { projectId: project.id, userId } });
    return this.customers(key);
  }

  // ─── Queues and SLAs (agents) ──────────────────────────────────────────────

  async queues(key: string, user: AuthUser) {
    const project = await this.desk(key);
    const queues = await this.prisma.queue.findMany({ where: { projectId: project.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    return Promise.all(queues.map(async (q) => {
      try {
        const { where } = compileJql(q.jql, { currentUserId: user.id });
        return { ...q, count: await this.prisma.issue.count({ where: { AND: [where, { projectId: project.id }] } }), error: null };
      } catch (e) {
        // A queue saved before a JQL change shouldn't break the whole page.
        if (e instanceof JqlError) return { ...q, count: 0, error: e.message };
        throw e;
      }
    }));
  }

  /** A queue's requests with their SLAs. Without an ORDER BY, the most urgent SLA comes first. */
  async queueIssues(key: string, queueId: string, user: AuthUser, startAt = 0, maxResults = 50) {
    const project = await this.desk(key);
    const queue = await this.queueOf(project.id, queueId);
    const { where, orderBy, explicitOrder } = this.compile(queue.jql, user);
    const scoped = { AND: [where, { projectId: project.id }] };
    const [total, issues] = await Promise.all([
      this.prisma.issue.count({ where: scoped }),
      this.prisma.issue.findMany({ where: scoped, include: QUEUE_INCLUDE, orderBy: { createdAt: 'asc' }, take: QUEUE_LIMIT }),
    ]);
    const goals = await this.goals([project.id]);
    const now = new Date();
    const rows = issues.map((i) => ({ issue: i, sla: computeSla(i, goals.get(`${i.projectId}:${i.priority}`), now) }));
    if (explicitOrder) rows.sort((a, b) => compareRows(a.issue, b.issue, orderBy));
    else rows.sort((a, b) => urgency(a.sla) - urgency(b.sla) || a.issue.createdAt.getTime() - b.issue.createdAt.getTime());

    const skip = Math.max(startAt, 0);
    const take = Math.min(Math.max(maxResults, 1), 200);
    return {
      queue,
      total,
      startAt: skip,
      maxResults: take,
      issues: rows.slice(skip, skip + take).map(({ issue, sla }) => ({
        id: issue.id,
        key: issue.key,
        summary: issue.summary,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        workflowStatus: issue.workflowStatus,
        requestType: issue.requestType,
        organization: issue.organization,
        reporter: issue.reporter,
        assignee: issue.assignee,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        sla,
      })),
    };
  }

  /** Request type, organization and SLAs of one issue, for the agent's issue view. */
  async requestInfo(idOrKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      include: {
        project: { select: { type: true } },
        requestType: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.project.type !== ProjectType.SERVICE_DESK) {
      return { serviceDesk: false, requestType: null, organization: null, organizations: [], sla: null };
    }
    const [goals, organizations] = await Promise.all([
      this.goals([issue.projectId]),
      this.prisma.organization.findMany({
        where: { projects: { some: { projectId: issue.projectId } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      serviceDesk: true,
      requestType: issue.requestType,
      organization: issue.organization,
      // What agents can share it with: the organizations the desk serves.
      organizations,
      sla: computeSla(issue, goals.get(`${issue.projectId}:${issue.priority}`)),
    };
  }

  // ─── Help center portal (customers and staff) ──────────────────────────────

  /** Service desks this user can raise requests in. */
  async portalDesks(user: AuthUser) {
    const where: Prisma.ProjectWhereInput = { type: ProjectType.SERVICE_DESK };
    if (user.role === UserRole.CUSTOMER) {
      where.OR = [
        { portalOpen: true },
        { customers: { some: { userId: user.id } } },
        { organizations: { some: { organization: { members: { some: { userId: user.id } } } } } },
      ];
    } else {
      const ids = await this.access.browsableProjectIds(user);
      if (ids !== null) where.id = { in: ids };
    }
    const desks = await this.prisma.project.findMany({
      where,
      select: {
        id: true, key: true, name: true, description: true, portalWelcome: true, portalColor: true, portalLogo: true,
        _count: { select: { requestTypes: true } },
      },
      orderBy: { name: 'asc' },
    });
    return desks.map(({ portalWelcome, portalColor, portalLogo, ...d }) => ({
      ...d, branding: brandingOf({ portalWelcome, portalColor, portalLogo }),
    }));
  }

  async portalDesk(key: string, user: AuthUser) {
    const project = await this.raisable(key, user);
    const [requestTypes, shareWith] = await Promise.all([this.requestTypes(project.id), this.shareOptions(project.id, user.id)]);
    return {
      key: project.key,
      name: project.name,
      description: project.description,
      branding: brandingOf(project),
      // The raiser's organizations this desk serves: they may share the request with one of them.
      shareWith,
      // Agents can raise a request for a customer (e.g. one who phoned in).
      canRaiseOnBehalf: user.role !== UserRole.CUSTOMER && (await this.access.can(user, project.id, 'edit')),
      requestTypes: requestTypes.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        fields: t.fields
          .filter((f) => PORTAL_FIELD_TYPES.includes(f.field.type))
          .map((f) => ({
            key: f.field.key,
            name: f.field.name,
            type: f.field.type,
            options: parseOptions(f.field.options),
            required: f.required,
          })),
      })),
    };
  }

  async raise(key: string, dto: PortalRequestDto, user: AuthUser) {
    const project = await this.raisable(key, user);
    const type = await this.prisma.requestType.findFirst({
      where: { id: dto.requestTypeId, projectId: project.id },
      include: { fields: { include: { field: true } } },
    });
    if (!type) throw new BadRequestException('Choose what you need help with');

    let reporterId = user.id;
    if (dto.onBehalfOfId && dto.onBehalfOfId !== user.id) {
      if (user.role === UserRole.CUSTOMER) throw new BadRequestException('You can only raise requests for yourself');
      await this.access.require(user, project.id, 'edit');
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

    // Sharing: an explicit organization must be one of the requester's that this desk serves;
    // otherwise (unless they opted out) share with the first such organization.
    const options = await this.shareOptions(project.id, reporterId);
    let organizationId: string | null = null;
    if (dto.organizationId) {
      if (!options.some((o) => o.id === dto.organizationId)) throw new BadRequestException('You can only share with your own organization');
      organizationId = dto.organizationId;
    } else if (dto.shareWithOrganization !== false) {
      organizationId = options[0]?.id ?? null;
    }

    const issue = await this.issues.create(
      {
        type: type.issueType,
        summary: dto.summary.trim(),
        description: dto.description,
        projectKey: project.key,
        customFields,
      },
      user,
      undefined,
      { requestTypeId: type.id, reporterId, organizationId },
    );
    return { key: issue.key };
  }

  /** The requester changes who a request is shared with: one of their organizations the desk serves, or nobody. */
  async shareRequest(key: string, user: AuthUser, organizationId: string | null) {
    const issue = await this.prisma.issue.findUnique({ where: { key: key.toUpperCase() }, include: { project: { select: { type: true } } } });
    if (!issue || issue.project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException('Request not found');
    if (issue.reporterId !== user.id) throw new ForbiddenException('Only the person who raised a request can change who it is shared with');
    if (organizationId && !(await this.shareOptions(issue.projectId, user.id)).some((o) => o.id === organizationId)) {
      throw new BadRequestException('You can only share with your own organization');
    }
    await this.recordOrganization(issue.id, issue.organizationId, organizationId, user.id);
    return this.request(key, user);
  }

  /** Requests the user raised, was added to, or (customers) that are shared with their organizations. */
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
        project: { select: { key: true, name: true } },
        workflowStatus: { select: { name: true, category: true } },
        requestType: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return issues.map((i) => ({
      key: i.key,
      summary: i.summary,
      status: { name: i.workflowStatus?.name ?? CATEGORY_NAMES[i.status], category: i.status },
      requestType: i.requestType,
      project: i.project,
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
        project: { select: { id: true, key: true, name: true, type: true } },
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
    const shareWith = issue.reporterId === user.id ? await this.shareOptions(issue.projectId, user.id) : null;
    return {
      organization: issue.organization,
      shareWith,
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      description: issue.description,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolution: issue.resolution,
      status: { name: issue.workflowStatus?.name ?? CATEGORY_NAMES[issue.status], category: issue.status },
      project: { key: issue.project.key, name: issue.project.name },
      requestType: issue.requestType ? { id: issue.requestType.id, name: issue.requestType.name } : null,
      reporter: issue.reporter ? { id: issue.reporter.id, name: issue.reporter.name } : null,
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

  /**
   * A reply from the portal. When the customer answers a request that was waiting for them,
   * it goes back to the agents (and the SLA clock resumes).
   */
  async portalComment(key: string, user: AuthUser, body: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { key: key.toUpperCase() },
      include: {
        project: { select: { type: true } },
        watchers: { select: { userId: true } },
        workflowStatus: { select: { pausesSla: true, category: true } },
      },
    });
    if (!issue || !(await this.canView(user, issue))) throw new NotFoundException('Request not found');
    await this.issues.addComment(issue.id, user, body);

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
    return this.request(key, user);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async desk(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException(`${key.toUpperCase()} is not a service desk`);
    return project;
  }

  /** Customers need an open portal, or to be listed (themselves or through an organization); staff need access to the project. */
  private async canRaise(user: AuthUser, project: Project) {
    if (project.type !== ProjectType.SERVICE_DESK) return false;
    if (user.role !== UserRole.CUSTOMER) return this.access.can(user, project.id, 'browse');
    if (project.portalOpen) return true;
    const [listed, viaOrganization] = await Promise.all([
      this.prisma.projectCustomer.findUnique({ where: { projectId_userId: { projectId: project.id, userId: user.id } } }),
      this.prisma.projectOrganization.findFirst({ where: { projectId: project.id, organization: { members: { some: { userId: user.id } } } } }),
    ]);
    return !!(listed || viaOrganization);
  }

  /** Organizations a request raised by this person in this desk can be shared with: theirs that the desk serves. */
  private shareOptions(projectId: string, userId: string) {
    return this.prisma.organization.findMany({
      where: { members: { some: { userId } }, projects: { some: { projectId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
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

  private async myOrganizationIds(userId: string) {
    return (await this.prisma.organizationMember.findMany({ where: { userId }, select: { organizationId: true } })).map((m) => m.organizationId);
  }

  /** 404 rather than 403, so customers can't discover service desks they don't belong to. */
  private async raisable(key: string, user: AuthUser) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || !(await this.canRaise(user, project))) throw new NotFoundException('Help center not found');
    return project;
  }

  /**
   * The reporter, participants and (when it's shared) members of its organization see a request;
   * so do staff who can browse its project.
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

  private requestTypes(projectId: string) {
    return this.prisma.requestType.findMany({
      where: { projectId },
      include: { fields: { include: { field: true }, orderBy: { position: 'asc' } }, _count: { select: { issues: true } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  private async requestTypeOf(projectId: string, id: string) {
    const type = await this.prisma.requestType.findFirst({ where: { id, projectId } });
    if (!type) throw new NotFoundException('Request type not found');
    return type;
  }

  private async queueOf(projectId: string, id: string) {
    const queue = await this.prisma.queue.findFirst({ where: { id, projectId } });
    if (!queue) throw new NotFoundException('Queue not found');
    return queue;
  }

  private async assertFields(projectId: string, fields?: { fieldId: string }[]) {
    if (!fields?.length) return;
    const ids = fields.map((f) => f.fieldId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each field can only be added once');
    const found = await this.prisma.customFieldDefinition.findMany({ where: { id: { in: ids }, projectId } });
    if (found.length !== ids.length) throw new BadRequestException('Fields must be custom fields of this project');
    const unsupported = found.find((f) => !PORTAL_FIELD_TYPES.includes(f.type));
    if (unsupported) throw new BadRequestException(`${unsupported.name} can't be shown on the portal (only text, number, select and date fields)`);
  }

  /** SLA goals by "projectId:priority". */
  private async goals(projectIds: string[]) {
    const targets = await this.prisma.slaTarget.findMany({ where: { projectId: { in: projectIds } } });
    return new Map<string, SlaGoals>(targets.map((t) => [`${t.projectId}:${t.priority}`, t]));
  }

  private compile(jql: string, user: AuthUser) {
    try {
      return compileJql(jql, { currentUserId: user.id });
    } catch (e) {
      if (e instanceof JqlError) throw new BadRequestException(`JQL error: ${e.message}`);
      throw e;
    }
  }

  private async unique<T>(message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(message);
      throw e;
    }
  }
}

/** A help center's look; null colour/logo means the default JiraTech style. */
function brandingOf(p: { portalWelcome: string | null; portalColor: string | null; portalLogo: string | null }) {
  return { welcome: p.portalWelcome, color: p.portalColor, logo: p.portalLogo };
}

/** Minutes left on the most pressing running clock; finished or paused ones sort last. */
function urgency(sla: Sla) {
  const running = [sla.firstResponse, sla.resolution].filter((c) => c && !c.completed && !c.paused);
  return running.length ? Math.min(...running.map((c) => c!.remainingMinutes)) : Number.MAX_SAFE_INTEGER;
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
