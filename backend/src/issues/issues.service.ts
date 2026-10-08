import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { IssueStatus, IssueResolution, LinkType, IssueType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidParentChild, WORKFLOW_TRANSITIONS } from '../common/issue-rules';
import { ISSUE_INCLUDE } from '../common/issue-include';
import { getSportsProject } from '../common/project.util';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import {
  CreateIssueDto, UpdateIssueDto, TransitionDto, CreateLinkDto, CreateWorkLogDto,
} from './dto/issue.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class IssuesService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor(
    private prisma: PrismaService,
    private customFieldsService: CustomFieldsService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private async nextIssueKey(projectId: string): Promise<{ key: string; number: number }> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const lastIssue = await this.prisma.issue.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const number = (lastIssue?.number ?? 0) + 1;
    return { key: `${project.key}-${number}`, number };
  }

  private async syncVersions(issueId: string, fixVersionIds?: string[], affectsVersionIds?: string[]) {
    if (fixVersionIds === undefined && affectsVersionIds === undefined) return;
    await this.prisma.issueVersion.deleteMany({ where: { issueId } });
    const creates = [
      ...(fixVersionIds ?? []).map((versionId) => ({ issueId, versionId, isFix: true })),
      ...(affectsVersionIds ?? []).map((versionId) => ({ issueId, versionId, isFix: false })),
    ];
    if (creates.length) {
      await this.prisma.issueVersion.createMany({ data: creates });
    }
  }

  private async syncLabels(issueId: string, labelIds?: string[]) {
    if (labelIds === undefined) return;
    await this.prisma.issueLabel.deleteMany({ where: { issueId } });
    if (labelIds.length) {
      await this.prisma.issueLabel.createMany({
        data: labelIds.map((labelId) => ({ issueId, labelId })),
      });
    }
  }

  async findAll(filters: {
    type?: IssueType;
    status?: IssueStatus;
    parentId?: string;
    sprintId?: string;
    piId?: string;
    assigneeId?: string;
    epicName?: string;
    search?: string;
  }) {
    const project = await getSportsProject(this.prisma);
    const where: Record<string, unknown> = { projectId: project.id };
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
        { key: { contains: filters.search } },
      ];
    }
    return this.prisma.issue.findMany({
      where,
      include: ISSUE_INCLUDE,
      orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const issue = await this.prisma.issue.findUnique({ where: { id }, include: ISSUE_INCLUDE });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  async create(dto: CreateIssueDto, reporterId: string) {
    const project = await getSportsProject(this.prisma);
    let parentType: IssueType | null = null;

    if (dto.parentId) {
      const parent = await this.prisma.issue.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('Parent issue not found');
      parentType = parent.type;
    }

    if (!isValidParentChild(dto.type, parentType)) {
      throw new BadRequestException(
        `Issue type ${dto.type} cannot be created under parent type ${parentType ?? 'none'}`,
      );
    }

    const { key, number } = await this.nextIssueKey(project.id);

    const issue = await this.prisma.issue.create({
      data: {
        key,
        number,
        type: dto.type,
        summary: dto.summary,
        description: dto.description,
        parentId: dto.parentId,
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
      },
      include: ISSUE_INCLUDE,
    });

    await this.syncVersions(issue.id, dto.fixVersionIds, dto.affectsVersionIds);
    if (dto.customFields) {
      await this.customFieldsService.setIssueValues(issue.id, dto.customFields);
    }

    return this.findOne(issue.id);
  }

  async update(id: string, dto: UpdateIssueDto) {
    await this.findOne(id);

    if (dto.componentIds) {
      await this.prisma.issueComponent.deleteMany({ where: { issueId: id } });
      if (dto.componentIds.length) {
        await this.prisma.issueComponent.createMany({
          data: dto.componentIds.map((componentId) => ({ issueId: id, componentId })),
        });
      }
    }

    await this.syncLabels(id, dto.labelIds);
    await this.syncVersions(id, dto.fixVersionIds, dto.affectsVersionIds);

    const {
      componentIds: _c, labelIds: _l, fixVersionIds: _f, affectsVersionIds: _a,
      customFields, ...data
    } = dto;

    await this.prisma.issue.update({
      where: { id },
      data,
    });

    if (customFields) {
      await this.customFieldsService.setIssueValues(id, customFields);
    }

    return this.findOne(id);
  }

  async transition(id: string, dto: TransitionDto) {
    const issue = await this.findOne(id);
    const allowed = WORKFLOW_TRANSITIONS[issue.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Cannot transition from ${issue.status} to ${dto.status}`);
    }

    if (dto.status === 'CLOSED' && !dto.resolution) {
      throw new BadRequestException('Resolution required when closing an issue');
    }

    await this.prisma.issue.update({
      where: { id },
      data: {
        status: dto.status as IssueStatus,
        resolution: dto.resolution as IssueResolution | undefined,
      },
    });

    return this.findOne(id);
  }

  async createLink(id: string, dto: CreateLinkDto) {
    await this.findOne(id);
    await this.findOne(dto.targetId);
    return this.prisma.issueLink.create({
      data: {
        sourceId: id,
        targetId: dto.targetId,
        type: dto.type as LinkType,
      },
    });
  }

  async addWatcher(issueId: string, userId: string) {
    await this.findOne(issueId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    try {
      await this.prisma.issueWatcher.create({ data: { issueId, userId } });
    } catch {
      throw new ConflictException('User is already watching this issue');
    }

    return this.findOne(issueId);
  }

  async removeWatcher(issueId: string, userId: string) {
    await this.prisma.issueWatcher.deleteMany({ where: { issueId, userId } });
    return this.findOne(issueId);
  }

  async createWorkLog(issueId: string, userId: string, dto: CreateWorkLogDto) {
    await this.findOne(issueId);
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

  async getWorkLogs(issueId: string) {
    await this.findOne(issueId);
    return this.prisma.workLog.findMany({
      where: { issueId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addAttachment(
    issueId: string,
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    await this.findOne(issueId);
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = path.join(this.uploadDir, safeName);
    fs.writeFileSync(storagePath, file.buffer);

    return this.prisma.attachment.create({
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
  }

  async getAttachment(issueId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, issueId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (!fs.existsSync(attachment.storagePath)) {
      throw new NotFoundException('Attachment file not found');
    }
    return attachment;
  }

  async updateCustomFields(issueId: string, customFields: Record<string, string>) {
    await this.findOne(issueId);
    await this.customFieldsService.setIssueValues(issueId, customFields);
    return this.findOne(issueId);
  }
}

