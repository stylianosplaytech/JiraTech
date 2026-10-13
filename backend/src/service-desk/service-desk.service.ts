import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { CustomFieldType, Prisma, Priority, ProjectType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { computeSla, Sla, SlaGoals } from '../common/sla';
import { issueRef } from '../common/issue-ref';
import { compileJql, JqlError } from '../search/jql';
import { compareRows } from '../search/search.service';
import {
  QueueDto, RequestTypeDto, SlaTargetDto, UpdateQueueDto, UpdateRequestTypeDto,
} from './dto/service-desk.dto';

const USER_BRIEF = { select: { id: true, name: true, email: true } } as const;
/** Field types a customer can fill in on a portal. */
export const PORTAL_FIELD_TYPES: CustomFieldType[] = [CustomFieldType.TEXT, CustomFieldType.NUMBER, CustomFieldType.SELECT, CustomFieldType.DATE];
/** Queues are sorted in memory (by SLA); larger queues show their first rows only. */
const QUEUE_LIMIT = 1000;

const QUEUE_INCLUDE = {
  workflowStatus: { select: { id: true, name: true, category: true } },
  assignee: USER_BRIEF,
  reporter: USER_BRIEF,
  requestType: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
  portal: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.IssueInclude;

/**
 * A service desk project's configuration (request types, SLA goals, queues) and the agents' view of its
 * requests. Its customer-facing portals live in PortalsService.
 */
@Injectable()
export class ServiceDeskService {
  constructor(private prisma: PrismaService) {}

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
      project: { id: project.id, key: project.key, name: project.name },
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
        portal: issue.portal,
        reporter: issue.reporter,
        assignee: issue.assignee,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        sla,
      })),
    };
  }

  /** Request type, portal, organization and SLAs of one issue, for the agent's issue view. */
  async requestInfo(idOrKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: issueRef(idOrKey),
      include: {
        project: { select: { type: true } },
        requestType: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
        portal: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.project.type !== ProjectType.SERVICE_DESK) {
      return { serviceDesk: false, requestType: null, portal: null, organization: null, organizations: [], sla: null };
    }
    const [goals, organizations] = await Promise.all([
      this.goals([issue.projectId]),
      // What agents can share it with: the organizations any of the project's portals serve.
      this.prisma.organization.findMany({
        where: { portals: { some: { portal: { projectId: issue.projectId } } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      serviceDesk: true,
      requestType: issue.requestType,
      portal: issue.portal,
      organization: issue.organization,
      organizations,
      sla: computeSla(issue, goals.get(`${issue.projectId}:${issue.priority}`)),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async desk(key: string) {
    const project = await this.prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (!project || project.type !== ProjectType.SERVICE_DESK) throw new NotFoundException(`${key.toUpperCase()} is not a service desk`);
    return project;
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
    if (unsupported) throw new BadRequestException(`${unsupported.name} can't be shown on a portal (only text, number, select and date fields)`);
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

/** Minutes left on the most pressing running clock; finished or paused ones sort last. */
function urgency(sla: Sla) {
  const running = [sla.firstResponse, sla.resolution].filter((c) => c && !c.completed && !c.paused);
  return running.length ? Math.min(...running.map((c) => c!.remainingMinutes)) : Number.MAX_SAFE_INTEGER;
}
