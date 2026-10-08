import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { IssueStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaClient | Prisma.TransactionClient;

/** The workflow every project starts with — identical to the original fixed workflow. */
const DEFAULT_STATUSES: { name: string; category: IssueStatus }[] = [
  { name: 'Backlog', category: IssueStatus.BACKLOG },
  { name: 'To Do', category: IssueStatus.TO_DO },
  { name: 'In Progress', category: IssueStatus.DOING },
  { name: 'Closed', category: IssueStatus.CLOSED },
];
const DEFAULT_TRANSITIONS: [string, string][] = [
  ['Backlog', 'To Do'],
  ['To Do', 'In Progress'], ['To Do', 'Backlog'],
  ['In Progress', 'Closed'], ['In Progress', 'To Do'],
  ['Closed', 'To Do'],
];

export const CATEGORY_NAMES: Record<IssueStatus, string> = {
  BACKLOG: 'Backlog', TO_DO: 'To Do', DOING: 'In Progress', CLOSED: 'Done',
};

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private prisma: PrismaService) {}

  /** Give every project a workflow and put existing issues into the matching status. */
  async onModuleInit() {
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    let backfilled = 0;
    for (const p of projects) {
      await this.ensure(this.prisma, p.id);
      backfilled += await this.backfill(p.id);
    }
    if (backfilled) this.logger.log(`Assigned workflow statuses to ${backfilled} existing issues`);
  }

  /** Create the default workflow for a project that has none. */
  async ensure(db: Db, projectId: string) {
    if (await db.workflowStatus.count({ where: { projectId } })) return;
    const ids = new Map<string, string>();
    for (const [i, s] of DEFAULT_STATUSES.entries()) {
      const created = await db.workflowStatus.create({ data: { projectId, name: s.name, category: s.category, position: i } });
      ids.set(s.name, created.id);
    }
    await db.workflowTransition.createMany({
      data: DEFAULT_TRANSITIONS.map(([from, to]) => ({ projectId, fromStatusId: ids.get(from)!, toStatusId: ids.get(to)! })),
    });
  }

  private async backfill(projectId: string) {
    const statuses = await this.statuses(projectId);
    let n = 0;
    for (const category of Object.values(IssueStatus)) {
      const target = statuses.find((s) => s.category === category);
      if (!target) continue;
      const r = await this.prisma.issue.updateMany({ where: { projectId, statusId: null, status: category }, data: { statusId: target.id } });
      n += r.count;
    }
    return n;
  }

  statuses(projectId: string, db: Db = this.prisma) {
    return db.workflowStatus.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  }

  async workflow(projectId: string) {
    await this.ensure(this.prisma, projectId);
    const [statuses, transitions, counts] = await Promise.all([
      this.statuses(projectId),
      this.prisma.workflowTransition.findMany({ where: { projectId }, select: { id: true, fromStatusId: true, toStatusId: true } }),
      this.prisma.issue.groupBy({ by: ['statusId'], where: { projectId }, _count: true }),
    ]);
    const issueCount = new Map(counts.map((c) => [c.statusId, c._count]));
    return {
      statuses: statuses.map((s) => ({ ...s, issueCount: issueCount.get(s.id) ?? 0 })),
      transitions,
    };
  }

  /** Status a new issue starts in: the first status of the workflow. */
  async initialStatus(db: Db, projectId: string) {
    await this.ensure(db, projectId);
    const first = await db.workflowStatus.findFirst({ where: { projectId }, orderBy: { position: 'asc' } });
    return first!;
  }

  /** First status of a category, for system actions such as "reject incident" or "sign off release". */
  async statusForCategory(db: Db, projectId: string, category: IssueStatus) {
    await this.ensure(db, projectId);
    const s = await db.workflowStatus.findFirst({ where: { projectId, category }, orderBy: { position: 'asc' } });
    if (!s) throw new BadRequestException(`This project's workflow has no ${CATEGORY_NAMES[category]} status`);
    return s;
  }

  /** Statuses an issue can move to from where it is now. */
  async availableTransitions(issueId: string) {
    const issue = await this.prisma.issue.findUniqueOrThrow({ where: { id: issueId }, select: { projectId: true, statusId: true } });
    await this.ensure(this.prisma, issue.projectId);
    if (!issue.statusId) return [];
    const transitions = await this.prisma.workflowTransition.findMany({
      where: { fromStatusId: issue.statusId },
      include: { toStatus: true },
    });
    return transitions
      .map((t) => t.toStatus)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, category: s.category }));
  }

  /**
   * Resolve the target of a transition request. Accepts a workflow status id, or (for older clients
   * and system actions) a category code such as "DOING", which picks the first reachable status of
   * that category.
   */
  async resolveTarget(
    issue: { projectId: string; statusId: string | null; status: IssueStatus },
    target: { statusId?: string; status?: string },
  ) {
    await this.ensure(this.prisma, issue.projectId);
    // Issues created outside the app may not have a workflow status yet: use their category's.
    const currentId = issue.statusId ?? (await this.statusForCategory(this.prisma, issue.projectId, issue.status)).id;
    issue = { ...issue, statusId: currentId };
    const allowed = await this.prisma.workflowTransition.findMany({ where: { fromStatusId: currentId }, include: { toStatus: true } });
    const reachable = allowed.map((t) => t.toStatus).sort((a, b) => a.position - b.position);

    if (target.statusId) {
      const to = await this.prisma.workflowStatus.findFirst({ where: { id: target.statusId, projectId: issue.projectId } });
      if (!to) throw new BadRequestException('That status is not part of this project\'s workflow');
      if (!reachable.some((s) => s.id === to.id)) {
        const from = issue.statusId ? await this.prisma.workflowStatus.findUnique({ where: { id: issue.statusId } }) : null;
        throw new BadRequestException(`Cannot move from ${from?.name ?? 'the current status'} to ${to.name}`);
      }
      return to;
    }
    if (target.status) {
      const to = reachable.find((s) => s.category === target.status)
        ?? reachable.find((s) => s.name.toLowerCase() === target.status!.toLowerCase());
      if (!to) throw new BadRequestException(`Cannot transition this issue to ${CATEGORY_NAMES[target.status as IssueStatus] ?? target.status}`);
      return to;
    }
    throw new BadRequestException('statusId or status is required');
  }

  // ─── Editing a project's workflow (project admins) ─────────────────────────

  async addStatus(projectId: string, name: string, category: IssueStatus) {
    await this.ensure(this.prisma, projectId);
    const clean = name.trim();
    if (!clean) throw new BadRequestException('Status name is required');
    if (await this.prisma.workflowStatus.findUnique({ where: { projectId_name: { projectId, name: clean } } })) {
      throw new ConflictException(`A status called ${clean} already exists`);
    }
    const { _max } = await this.prisma.workflowStatus.aggregate({ where: { projectId }, _max: { position: true } });
    return this.prisma.workflowStatus.create({ data: { projectId, name: clean, category, position: (_max.position ?? -1) + 1 } });
  }

  async updateStatus(projectId: string, statusId: string, data: { name?: string; category?: IssueStatus }) {
    const status = await this.statusOf(projectId, statusId);
    const name = data.name?.trim();
    if (name !== undefined && !name) throw new BadRequestException('Status name is required');
    if (name && name !== status.name && await this.prisma.workflowStatus.findUnique({ where: { projectId_name: { projectId, name } } })) {
      throw new ConflictException(`A status called ${name} already exists`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowStatus.update({ where: { id: statusId }, data: { name, category: data.category } });
      // Keep the category column of issues in this status in sync.
      if (data.category && data.category !== status.category) {
        await tx.issue.updateMany({ where: { statusId }, data: { status: data.category } });
      }
      return updated;
    });
  }

  async reorder(projectId: string, orderedIds: string[]) {
    const statuses = await this.statuses(projectId);
    if (orderedIds.length !== statuses.length || !statuses.every((s) => orderedIds.includes(s.id))) {
      throw new BadRequestException('The new order must list every status exactly once');
    }
    await this.prisma.$transaction(orderedIds.map((id, position) => this.prisma.workflowStatus.update({ where: { id }, data: { position } })));
    return this.workflow(projectId);
  }

  /** Delete a status; its issues move to `moveToId`. */
  async deleteStatus(projectId: string, statusId: string, moveToId?: string) {
    await this.statusOf(projectId, statusId);
    const statuses = await this.statuses(projectId);
    if (statuses.length <= 1) throw new BadRequestException('A workflow needs at least one status');
    const inUse = await this.prisma.issue.count({ where: { statusId } });
    let target: { id: string; category: IssueStatus } | null = null;
    if (inUse) {
      if (!moveToId || moveToId === statusId) {
        throw new BadRequestException(`${inUse} issue(s) are in this status. Choose a status to move them to.`);
      }
      target = await this.statusOf(projectId, moveToId);
    }
    await this.prisma.$transaction(async (tx) => {
      if (target) {
        await tx.issue.updateMany({
          where: { statusId },
          data: { statusId: target.id, status: target.category, ...(target.category !== IssueStatus.CLOSED ? { resolution: null } : {}) },
        });
      }
      await tx.workflowStatus.delete({ where: { id: statusId } });
    });
    return this.workflow(projectId);
  }

  /** Replace all transitions of a project's workflow. */
  async setTransitions(projectId: string, pairs: { fromStatusId: string; toStatusId: string }[]) {
    const ids = new Set((await this.statuses(projectId)).map((s) => s.id));
    const clean = pairs.filter((p) => p.fromStatusId !== p.toStatusId);
    for (const p of clean) {
      if (!ids.has(p.fromStatusId) || !ids.has(p.toStatusId)) throw new BadRequestException('Transitions must use this project\'s statuses');
    }
    const unique = [...new Map(clean.map((p) => [`${p.fromStatusId}>${p.toStatusId}`, p])).values()];
    await this.prisma.$transaction([
      this.prisma.workflowTransition.deleteMany({ where: { projectId } }),
      this.prisma.workflowTransition.createMany({ data: unique.map((p) => ({ ...p, projectId })) }),
    ]);
    return this.workflow(projectId);
  }

  private async statusOf(projectId: string, statusId: string) {
    const s = await this.prisma.workflowStatus.findFirst({ where: { id: statusId, projectId } });
    if (!s) throw new NotFoundException('Status not found in this project');
    return s;
  }
}
