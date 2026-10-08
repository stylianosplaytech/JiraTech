import {
  Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException,
} from '@nestjs/common';
import { IssueStatus, IssueResolution, LinkType, IssueType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidParentChild, WORKFLOW_TRANSITIONS } from '../common/issue-rules';
import { ISSUE_INCLUDE } from '../common/issue-include';
import { nextIssueKey, resolveProject } from '../common/project.util';
import { AuthUser } from '../common/auth-user';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { NotificationsService, extractMentions } from '../notifications/notifications.service';
import { AccessService } from '../access/access.service';
import {
  CreateIssueDto, UpdateIssueDto, TransitionDto, CreateLinkDto, CreateWorkLogDto,
} from './dto/issue.dto';
import * as fs from 'fs';
import * as path from 'path';

type Tx = Prisma.TransactionClient;

interface HistoryChange {
  field: string;
  from?: string | null;
  to?: string | null;
}

const USER_BRIEF = { select: { id: true, name: true, email: true } };

@Injectable()
export class IssuesService {
  private readonly uploadDir = path.resolve(__dirname, '../../uploads');

  constructor(
    private prisma: PrismaService,
    private customFieldsService: CustomFieldsService,
    private notifications: NotificationsService,
    private access: AccessService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async findAll(
    filters: {
      type?: IssueType;
      status?: IssueStatus;
      parentId?: string;
      sprintId?: string;
      piId?: string;
      assigneeId?: string;
      epicName?: string;
      search?: string;
    },
    projectKey?: string,
  ) {
    const project = await resolveProject(this.prisma, projectKey);
    const where: Prisma.IssueWhereInput = { projectId: project.id };
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.parentId) where.parentId = filters.parentId;
    if (filters.sprintId) where.sprintId = filters.sprintId;
    if (filters.piId) where.piId = filters.piId;
    if (filters.assigneeId) where.assigneeId = filters.assigneeId;
    if (filters.epicName) where.epicName = filters.epicName;
    if (filters.search) {
      where.OR = [
        { summary: { contains: filters.search } },
        { key: { contains: filters.search.toUpperCase() } },
      ];
    }
    return this.prisma.issue.findMany({
      where,
      include: ISSUE_INCLUDE,
      orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** Look up by id or by key (e.g. SPORTS-12), like Jira's /browse/KEY. */
  async findOne(idOrKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  private async findIdOrThrow(idOrKey: string) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      select: { id: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue.id;
  }

  // ─── Create / update / delete ──────────────────────────────────────────────

  async create(dto: CreateIssueDto, user: AuthUser, headerProjectKey?: string) {
    const reporterId = user.id;
    let parent: { id: string; type: IssueType; projectId: string } | null = null;
    if (dto.parentId) {
      parent = await this.prisma.issue.findFirst({
        where: { OR: [{ id: dto.parentId }, { key: dto.parentId.toUpperCase() }] },
        select: { id: true, type: true, projectId: true },
      });
      if (!parent) throw new NotFoundException('Parent issue not found');
    }

    // Children always live in their parent's project.
    const project = parent
      ? await this.prisma.project.findUniqueOrThrow({ where: { id: parent.projectId } })
      : await resolveProject(this.prisma, dto.projectKey ?? headerProjectKey);
    await this.access.require(user, project.id, 'edit');

    if ((parent || project.strictHierarchy) && !isValidParentChild(dto.type, parent?.type ?? null)) {
      throw new BadRequestException(
        `Issue type ${dto.type} cannot be created under parent type ${parent?.type ?? 'none'}`,
      );
    }

    const issueId = await this.prisma.$transaction(async (tx) => {
      const { key, number } = await nextIssueKey(tx, project.id);
      const issue = await tx.issue.create({
        data: {
          key,
          number,
          type: dto.type,
          summary: dto.summary,
          description: dto.description,
          parentId: parent?.id,
          epicName: dto.epicName,
          priority: dto.priority,
          assigneeId: dto.assigneeId,
          sprintId: dto.sprintId,
          piId: dto.piId,
          parentLinkKey: dto.parentLinkKey,
          estimate: dto.estimate,
          remainingEstimate: dto.remainingEstimate ?? dto.estimate,
          reporterId: dto.reporterId ?? reporterId,
          projectId: project.id,
          components: dto.componentIds?.length
            ? { create: dto.componentIds.map((componentId) => ({ componentId })) }
            : undefined,
          labels: dto.labelIds?.length
            ? { create: dto.labelIds.map((labelId) => ({ labelId })) }
            : undefined,
          // Reporter watches their own issue by default, as in Jira.
          watchers: { create: { userId: reporterId } },
        },
        select: { id: true, key: true },
      });
      await this.syncVersions(tx, issue.id, dto.fixVersionIds, dto.affectsVersionIds);
      await this.recordHistory(tx, issue.id, reporterId, [{ field: 'created', to: issue.key }]);
      return issue.id;
    });

    if (dto.customFields) {
      await this.customFieldsService.setIssueValues(issueId, dto.customFields);
    }
    await this.notifications.issueCreated(issueId, reporterId);
    return this.findOne(issueId);
  }

  async update(idOrKey: string, dto: UpdateIssueDto, userId: string) {
    const before = await this.findOne(idOrKey);
    const id = before.id;

    const changed = await this.prisma.$transaction(async (tx) => {
      const changes: HistoryChange[] = [];

      if (dto.componentIds) {
        await tx.issueComponent.deleteMany({ where: { issueId: id } });
        if (dto.componentIds.length) {
          await tx.issueComponent.createMany({
            data: dto.componentIds.map((componentId) => ({ issueId: id, componentId })),
          });
        }
        const names = await tx.component.findMany({ where: { id: { in: dto.componentIds } }, select: { name: true } });
        changes.push(listChange('components', before.components.map((c) => c.component.name), names.map((n) => n.name)));
      }

      if (dto.labelIds) {
        await tx.issueLabel.deleteMany({ where: { issueId: id } });
        if (dto.labelIds.length) {
          await tx.issueLabel.createMany({ data: dto.labelIds.map((labelId) => ({ issueId: id, labelId })) });
        }
        const names = await tx.label.findMany({ where: { id: { in: dto.labelIds } }, select: { name: true } });
        changes.push(listChange('labels', before.labels.map((l) => l.label.name), names.map((n) => n.name)));
      }

      if (dto.fixVersionIds !== undefined || dto.affectsVersionIds !== undefined) {
        // Keep whichever side the client did not send.
        const fix = dto.fixVersionIds ?? before.versions.filter((v) => v.isFix).map((v) => v.versionId);
        const affects = dto.affectsVersionIds ?? before.versions.filter((v) => !v.isFix).map((v) => v.versionId);
        await this.syncVersions(tx, id, fix, affects);
        const versionNames = async (ids: string[]) =>
          (await tx.version.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((v) => v.name);
        if (dto.fixVersionIds !== undefined) {
          changes.push(listChange('fixVersions', before.versions.filter((v) => v.isFix).map((v) => v.version.name), await versionNames(fix)));
        }
        if (dto.affectsVersionIds !== undefined) {
          changes.push(listChange('affectsVersions', before.versions.filter((v) => !v.isFix).map((v) => v.version.name), await versionNames(affects)));
        }
      }

      const {
        componentIds: _c, labelIds: _l, fixVersionIds: _f, affectsVersionIds: _a,
        customFields: _cf, ...data
      } = dto;

      for (const field of ['summary', 'description', 'priority', 'estimate', 'remainingEstimate', 'blocked', 'epicName'] as const) {
        if (data[field] !== undefined && data[field] !== before[field]) {
          changes.push({ field, from: str(before[field]), to: str(data[field]) });
        }
      }
      if (data.assigneeId !== undefined && data.assigneeId !== before.assigneeId) {
        changes.push({ field: 'assignee', from: before.assignee?.name ?? null, to: await this.userName(tx, data.assigneeId) });
      }
      if (data.reporterId !== undefined && data.reporterId !== before.reporterId) {
        changes.push({ field: 'reporter', from: before.reporter?.name ?? null, to: await this.userName(tx, data.reporterId) });
      }
      if (data.sprintId !== undefined && data.sprintId !== before.sprintId) {
        const sprint = data.sprintId ? await tx.sprint.findUnique({ where: { id: data.sprintId } }) : null;
        changes.push({ field: 'sprint', from: before.sprint?.name ?? null, to: sprint?.name ?? null });
      }

      // Empty strings from the UI mean "clear the field".
      const clean = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v === '' && k !== 'summary' ? null : v]),
      );
      await tx.issue.update({ where: { id }, data: clean });
      const real = changes.filter((c) => c.from !== c.to);
      await this.recordHistory(tx, id, userId, real);
      return real.map((c) => c.field);
    });

    if (dto.customFields) {
      await this.customFieldsService.setIssueValues(id, dto.customFields);
    }
    await this.notifications.issueUpdated(id, userId, {
      fields: changed,
      previousAssigneeId: before.assigneeId,
      previousDescription: before.description,
    });
    return this.findOne(id);
  }

  async remove(idOrKey: string, user: AuthUser) {
    const issue = await this.prisma.issue.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toUpperCase() }] },
      include: { project: true, attachments: true, _count: { select: { children: true } } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    const perms = await this.access.permissions(user, issue.projectId);
    const allowed = perms.canAdmin || (perms.canEdit && user.id === issue.reporterId);
    if (!allowed) throw new ForbiddenException('Only project administrators, or the reporter, can delete an issue');
    if (issue._count.children > 0) {
      throw new BadRequestException(`${issue.key} has ${issue._count.children} child issue(s); delete or move them first`);
    }

    await this.notifications.issueDeleted(issue.id, user.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.issueComponent.deleteMany({ where: { issueId: issue.id } });
      await tx.issueVersion.deleteMany({ where: { issueId: issue.id } });
      await tx.issue.delete({ where: { id: issue.id } });
    });
    for (const a of issue.attachments) {
      fs.rm(a.storagePath, { force: true }, () => undefined);
    }
    return { deleted: true, key: issue.key };
  }

  async transition(idOrKey: string, dto: TransitionDto, userId: string) {
    const issue = await this.findOne(idOrKey);
    const allowed = WORKFLOW_TRANSITIONS[issue.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Cannot transition from ${issue.status} to ${dto.status}`);
    }
    if (dto.status === 'CLOSED' && !dto.resolution) {
      throw new BadRequestException('Resolution required when closing an issue');
    }
    // Leaving CLOSED (re-open) clears the resolution.
    const resolution = dto.status === 'CLOSED' ? (dto.resolution as IssueResolution) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({
        where: { id: issue.id },
        data: { status: dto.status as IssueStatus, resolution },
      });
      const changes: HistoryChange[] = [{ field: 'status', from: issue.status, to: dto.status }];
      if ((issue.resolution ?? null) !== resolution) {
        changes.push({ field: 'resolution', from: issue.resolution, to: resolution });
      }
      await this.recordHistory(tx, issue.id, userId, changes);
    });
    await this.notifications.statusChanged(issue.id, userId, issue.status, dto.status);
    return this.findOne(issue.id);
  }

  // ─── Links ─────────────────────────────────────────────────────────────────

  async createLink(idOrKey: string, dto: CreateLinkDto, user: AuthUser) {
    const userId = user.id;
    const source = await this.findOne(idOrKey);
    const targetRef = dto.targetId ?? dto.targetKey;
    if (!targetRef) throw new BadRequestException('targetId or targetKey is required');
    const target = await this.findOne(targetRef);
    await this.access.require(user, target.projectId, 'browse');
    if (source.id === target.id) throw new BadRequestException('An issue cannot be linked to itself');
    if (!Object.values(LinkType).includes(dto.type as LinkType)) {
      throw new BadRequestException(`Unknown link type ${dto.type}`);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.issueLink.create({
          data: { sourceId: source.id, targetId: target.id, type: dto.type as LinkType },
        });
        await this.recordHistory(tx, source.id, userId, [{ field: 'link', to: `${linkLabel(dto.type)} ${target.key}` }]);
        await this.recordHistory(tx, target.id, userId, [{ field: 'link', to: `${linkLabel(dto.type, true)} ${source.key}` }]);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`${source.key} already ${linkLabel(dto.type)} ${target.key}`);
      }
      throw e;
    }
    return this.findOne(source.id);
  }

  async removeLink(idOrKey: string, linkId: string, userId: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const link = await this.prisma.issueLink.findFirst({
      where: { id: linkId, OR: [{ sourceId: issueId }, { targetId: issueId }] },
      include: { source: { select: { key: true } }, target: { select: { key: true } } },
    });
    if (!link) throw new NotFoundException('Link not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.issueLink.delete({ where: { id: link.id } });
      await this.recordHistory(tx, link.sourceId, userId, [{ field: 'link', from: `${linkLabel(link.type)} ${link.target.key}` }]);
      await this.recordHistory(tx, link.targetId, userId, [{ field: 'link', from: `${linkLabel(link.type, true)} ${link.source.key}` }]);
    });
    return this.findOne(issueId);
  }

  // ─── Watchers ──────────────────────────────────────────────────────────────

  async addWatcher(idOrKey: string, userId: string, actorId: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    try {
      await this.prisma.issueWatcher.create({ data: { issueId, userId } });
    } catch {
      throw new ConflictException('User is already watching this issue');
    }
    await this.notifications.watcherAdded(issueId, actorId, userId);
    return this.findOne(issueId);
  }

  async removeWatcher(idOrKey: string, userId: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    await this.prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
    return this.findOne(issueId);
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  async getComments(idOrKey: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    return this.prisma.comment.findMany({
      where: { issueId },
      include: { author: USER_BRIEF },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(idOrKey: string, authorId: string, body: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const text = body.trim();
    if (!text) throw new BadRequestException('Comment cannot be empty');
    const created = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { issueId, authorId, body: text },
        include: { author: USER_BRIEF },
      });
      // Commenters (and anyone @mentioned by email) start watching the issue, as in Jira.
      const mentioned = await tx.user.findMany({
        where: { email: { in: extractMentions(text) } },
        select: { id: true },
      });
      for (const userId of new Set([authorId, ...mentioned.map((u) => u.id)])) {
        await tx.issueWatcher.upsert({
          where: { issueId_userId: { issueId, userId } },
          create: { issueId, userId },
          update: {},
        });
      }
      await tx.issue.update({ where: { id: issueId }, data: { updatedAt: new Date() } });
      return comment;
    });
    await this.notifications.commentAdded(issueId, authorId, text);
    return created;
  }

  async updateComment(idOrKey: string, commentId: string, user: AuthUser, body: string) {
    const comment = await this.findComment(idOrKey, commentId);
    if (comment.authorId !== user.id) throw new ForbiddenException('You can only edit your own comments');
    const text = body.trim();
    if (!text) throw new BadRequestException('Comment cannot be empty');
    const updated = await this.prisma.comment.update({
      where: { id: comment.id },
      data: { body: text },
      include: { author: USER_BRIEF },
    });
    await this.notifications.commentEdited(comment.issueId, user.id, comment.body, text);
    return updated;
  }

  async deleteComment(idOrKey: string, commentId: string, user: AuthUser) {
    const comment = await this.findComment(idOrKey, commentId);
    if (comment.authorId !== user.id && !(await this.access.can(user, comment.issue.projectId, 'admin'))) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.comment.delete({ where: { id: comment.id } });
    return { deleted: true };
  }

  private async findComment(idOrKey: string, commentId: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, issueId },
      include: { issue: { select: { projectId: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  // ─── History ───────────────────────────────────────────────────────────────

  async getHistory(idOrKey: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    return this.prisma.issueHistory.findMany({
      where: { issueId },
      include: { user: USER_BRIEF },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recordHistory(tx: Tx, issueId: string, userId: string | null, changes: HistoryChange[]) {
    if (!changes.length) return;
    await tx.issueHistory.createMany({
      data: changes.map((c) => ({
        issueId,
        userId,
        field: c.field,
        fromValue: truncate(c.from),
        toValue: truncate(c.to),
      })),
    });
  }

  private async userName(tx: Tx, id: string | null | undefined) {
    if (!id) return null;
    const user = await tx.user.findUnique({ where: { id }, select: { name: true } });
    return user?.name ?? id;
  }

  // ─── Work logs ─────────────────────────────────────────────────────────────

  async createWorkLog(idOrKey: string, userId: string, dto: CreateWorkLogDto) {
    const issueId = await this.findIdOrThrow(idOrKey);
    await this.prisma.workLog.create({
      data: {
        issueId,
        userId,
        timeSpentMinutes: dto.timeSpentMinutes,
        comment: dto.comment,
      },
    });
    return this.findOne(issueId);
  }

  async getWorkLogs(idOrKey: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    return this.prisma.workLog.findMany({
      where: { issueId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  async addAttachment(
    idOrKey: string,
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = path.join(this.uploadDir, safeName);
    fs.writeFileSync(storagePath, file.buffer);

    return this.prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          issueId,
          filename: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storagePath,
          uploadedById: userId,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      await this.recordHistory(tx, issueId, userId, [{ field: 'attachment', to: file.originalname }]);
      return attachment;
    });
  }

  async getAttachment(idOrKey: string, attachmentId: string) {
    const issueId = await this.findIdOrThrow(idOrKey);
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, issueId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (!fs.existsSync(attachment.storagePath)) {
      throw new NotFoundException('Attachment file not found');
    }
    return attachment;
  }

  async deleteAttachment(idOrKey: string, attachmentId: string, user: AuthUser) {
    const attachment = await this.getAttachment(idOrKey, attachmentId).catch(async (e) => {
      // Still allow removing the record when the file itself has gone missing.
      const issueId = await this.findIdOrThrow(idOrKey);
      const record = await this.prisma.attachment.findFirst({ where: { id: attachmentId, issueId } });
      if (!record) throw e;
      return record;
    });
    if (attachment.uploadedById !== user.id && !(await this.access.can(user, await this.access.projectOfIssue(attachment.issueId), 'admin'))) {
      throw new ForbiddenException('You can only delete attachments you uploaded');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachment.id } });
      await this.recordHistory(tx, attachment.issueId, user.id, [{ field: 'attachment', from: attachment.filename }]);
    });
    fs.rm(attachment.storagePath, { force: true }, () => undefined);
    return { deleted: true };
  }

  async updateCustomFields(idOrKey: string, customFields: Record<string, string>) {
    const issueId = await this.findIdOrThrow(idOrKey);
    await this.customFieldsService.setIssueValues(issueId, customFields);
    return this.findOne(issueId);
  }

  private async syncVersions(tx: Tx, issueId: string, fixVersionIds?: string[], affectsVersionIds?: string[]) {
    if (fixVersionIds === undefined && affectsVersionIds === undefined) return;
    await tx.issueVersion.deleteMany({ where: { issueId } });
    const creates = [
      ...(fixVersionIds ?? []).map((versionId) => ({ issueId, versionId, isFix: true })),
      ...(affectsVersionIds ?? []).map((versionId) => ({ issueId, versionId, isFix: false })),
    ];
    if (creates.length) {
      await tx.issueVersion.createMany({ data: creates });
    }
  }
}

const LINK_LABELS: Record<string, [string, string]> = {
  BLOCKS: ['blocks', 'is blocked by'],
  DEPENDS_ON: ['depends on', 'is depended on by'],
  RELATES_TO: ['relates to', 'relates to'],
  PARENT_LINK: ['is parent of', 'is child of'],
};

function linkLabel(type: string, inward = false) {
  const labels = LINK_LABELS[type];
  return labels ? labels[inward ? 1 : 0] : type;
}

function str(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v);
}

function listChange(field: string, from: string[], to: string[]): HistoryChange {
  const join = (xs: string[]) => (xs.length ? [...xs].sort().join(', ') : null);
  return { field, from: join(from), to: join(to) };
}

function truncate(v: string | null | undefined) {
  if (v === null || v === undefined) return null;
  return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
}
