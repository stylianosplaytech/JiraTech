import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth-user';
import { AccessService } from '../access/access.service';
import { IssuesService } from './issues.service';
import { MoveService } from './move.service';
import { resolveProject } from '../common/project.util';

export type BulkAction = 'edit' | 'transition' | 'watch' | 'delete' | 'move';

export interface BulkRequest {
  issueIds: string[];
  action: BulkAction;
  notify?: boolean;
  // edit
  assigneeId?: string | null; // null / '' = unassign; undefined = keep
  priority?: Priority;
  dueDate?: string | null; // yyyy-mm-dd to set; null / '' = clear; undefined = keep
  addLabelIds?: string[];
  removeLabelIds?: string[];
  addComponentIds?: string[];
  addFixVersionIds?: string[];
  // transition
  statusName?: string;
  resolution?: string;
  // move
  projectKey?: string;
}

export interface BulkResult {
  succeeded: { id: string; key: string }[];
  failed: { id: string; key: string; error: string }[];
}

const MAX_ISSUES = 200;

/**
 * Applies one change to many issues. Each issue goes through the same permission checks and
 * rules as a single edit; failures are reported per issue instead of aborting the batch.
 */
@Injectable()
export class BulkService {
  constructor(
    private prisma: PrismaService,
    private access: AccessService,
    private issues: IssuesService,
    private mover: MoveService,
  ) {}

  async run(req: BulkRequest, user: AuthUser): Promise<BulkResult> {
    const ids = [...new Set(req.issueIds)];
    if (!ids.length) throw new BadRequestException('Select at least one issue');
    if (ids.length > MAX_ISSUES) throw new BadRequestException(`You can change at most ${MAX_ISSUES} issues at once`);
    if (req.action === 'edit' && !this.hasEdits(req)) throw new BadRequestException('Choose at least one field to change');
    if (req.action === 'transition' && !req.statusName?.trim()) throw new BadRequestException('Choose a status');
    if (req.action === 'move' && !req.projectKey?.trim()) throw new BadRequestException('Choose the project to move to');

    const issues = await this.prisma.issue.findMany({
      where: { id: { in: ids } },
      include: {
        labels: { select: { labelId: true } },
        components: { select: { componentId: true } },
        versions: { select: { versionId: true, isFix: true } },
      },
    });
    const result: BulkResult = { succeeded: [], failed: [] };
    for (const id of ids.filter((x) => !issues.some((i) => i.id === x))) {
      result.failed.push({ id, key: '?', error: 'Issue not found' });
    }
    const notify = req.notify !== false;
    if (req.action === 'move') return this.moveAll(issues, req.projectKey!.trim(), user, notify, result);

    for (const issue of issues) {
      try {
        switch (req.action) {
          case 'edit':
            await this.access.require(user, issue.projectId, 'edit');
            await this.issues.update(issue.id, await this.editFor(issue, req), user.id, { notify });
            break;
          case 'transition': {
            await this.access.require(user, issue.projectId, 'edit');
            const target = await this.prisma.workflowStatus.findFirst({
              where: { projectId: issue.projectId, name: req.statusName!.trim() },
            });
            if (!target) throw new BadRequestException(`This project's workflow has no "${req.statusName}" status`);
            if (target.id === issue.statusId) break; // already there: nothing to do
            await this.issues.transition(issue.id, { statusId: target.id, resolution: req.resolution }, user.id, { notify });
            break;
          }
          case 'watch':
            await this.access.require(user, issue.projectId, 'browse');
            await this.prisma.issueWatcher.upsert({
              where: { issueId_userId: { issueId: issue.id, userId: user.id } },
              create: { issueId: issue.id, userId: user.id },
              update: {},
            });
            break;
          case 'delete':
            await this.access.require(user, issue.projectId, 'browse');
            await this.issues.remove(issue.id, user, { notify });
            break;
          default:
            throw new BadRequestException(`Unknown action ${String(req.action)}`);
        }
        result.succeeded.push({ id: issue.id, key: issue.key });
      } catch (e) {
        result.failed.push({ id: issue.id, key: issue.key, error: errorText(e) });
      }
    }
    return result;
  }

  /**
   * Sub-tasks move with their parent, so an issue with a parent (at any level) that is also selected isn't moved on
   * its own: it has moved once that ancestor has.
   */
  private async moveAll(issues: { id: string; key: string; parentId: string | null }[], projectKey: string, user: AuthUser, notify: boolean, result: BulkResult) {
    const target = await resolveProject(this.prisma, projectKey);
    const selected = new Set(issues.map((i) => i.id));
    const withAncestor = new Set<string>();
    for (const issue of issues) {
      for (let parentId = issue.parentId; parentId;) {
        if (selected.has(parentId)) { withAncestor.add(issue.id); break; }
        parentId = (await this.prisma.issue.findUnique({ where: { id: parentId }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    for (const issue of issues.filter((i) => !withAncestor.has(i.id))) {
      try {
        const moved = await this.mover.move(issue.id, { projectKey }, user, { notify });
        result.succeeded.push({ id: issue.id, key: moved.key });
      } catch (e) {
        result.failed.push({ id: issue.id, key: issue.key, error: errorText(e) });
      }
    }
    for (const issue of issues.filter((i) => withAncestor.has(i.id))) {
      const now = await this.prisma.issue.findUnique({ where: { id: issue.id }, select: { key: true, projectId: true } });
      if (now?.projectId === target.id) result.succeeded.push({ id: issue.id, key: now.key });
      else result.failed.push({ id: issue.id, key: issue.key, error: "Not moved: it moves with its parent, which couldn't be moved" });
    }
    return result;
  }

  private hasEdits(r: BulkRequest) {
    return r.assigneeId !== undefined || !!r.priority || r.dueDate !== undefined || !!r.addLabelIds?.length || !!r.removeLabelIds?.length
      || !!r.addComponentIds?.length || !!r.addFixVersionIds?.length;
  }

  /** Turn "add/remove" requests into the full lists a single update expects, checking project ownership. */
  private async editFor(
    issue: { projectId: string; labels: { labelId: string }[]; components: { componentId: string }[]; versions: { versionId: string; isFix: boolean }[] },
    r: BulkRequest,
  ) {
    const inProject = async (model: 'label' | 'component' | 'version', ids: string[] | undefined, what: string) => {
      if (!ids?.length) return;
      const found = await (this.prisma[model] as unknown as { count: (a: object) => Promise<number> })
        .count({ where: { id: { in: ids }, projectId: issue.projectId } });
      if (found !== ids.length) throw new BadRequestException(`Some of the selected ${what} don't belong to this issue's project`);
    };
    await inProject('label', r.addLabelIds, 'labels');
    await inProject('component', r.addComponentIds, 'components');
    await inProject('version', r.addFixVersionIds, 'versions');

    const dto: Record<string, unknown> = {};
    if (r.assigneeId !== undefined) dto.assigneeId = r.assigneeId ?? '';
    if (r.priority) dto.priority = r.priority;
    if (r.dueDate !== undefined) dto.dueDate = r.dueDate ?? '';
    if (r.addLabelIds?.length || r.removeLabelIds?.length) {
      const labels = new Set(issue.labels.map((l) => l.labelId));
      r.addLabelIds?.forEach((id) => labels.add(id));
      r.removeLabelIds?.forEach((id) => labels.delete(id));
      dto.labelIds = [...labels];
    }
    if (r.addComponentIds?.length) {
      dto.componentIds = [...new Set([...issue.components.map((c) => c.componentId), ...r.addComponentIds])];
    }
    if (r.addFixVersionIds?.length) {
      dto.fixVersionIds = [...new Set([...issue.versions.filter((v) => v.isFix).map((v) => v.versionId), ...r.addFixVersionIds])];
    }
    return dto;
  }
}

function errorText(e: unknown) {
  const message = e instanceof HttpException ? (e.getResponse() as { message?: string | string[] }).message ?? e.message : (e as Error).message;
  return Array.isArray(message) ? message.join(', ') : String(message);
}
