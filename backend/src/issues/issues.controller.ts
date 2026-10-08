import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
  UseInterceptors, UploadedFile, Res, StreamableFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IssueStatus, IssueType } from '@prisma/client';
import { Response } from 'express';
import * as fs from 'fs';
import { IssuesService } from './issues.service';
import {
  CreateIssueDto, UpdateIssueDto, TransitionDto, CreateLinkDto,
  AddWatcherDto, CreateWorkLogDto, UpdateCustomFieldsDto, CommentDto,
} from './dto/issue.dto';
import { JwtAuthGuard } from '../auth/guards';
import { ProjectKey } from '../common/project-key.decorator';
import { AuthRequest } from '../common/auth-user';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { AccessService } from '../access/access.service';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ISSUE = { from: 'issueParam', param: 'id' } as const;

@Controller('issues')
@UseGuards(JwtAuthGuard, AccessGuard)
export class IssuesController {
  constructor(private issuesService: IssuesService, private access: AccessService) {}

  @Get()
  @RequireAccess('browse')
  findAll(
    @ProjectKey() projectKey?: string,
    @Query('type') type?: IssueType,
    @Query('status') status?: IssueStatus,
    @Query('parentId') parentId?: string,
    @Query('sprintId') sprintId?: string,
    @Query('piId') piId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('epicName') epicName?: string,
    @Query('search') search?: string,
  ) {
    return this.issuesService.findAll(
      { type, status, parentId, sprintId, piId, assigneeId, epicName, search },
      projectKey,
    );
  }

  /** The issue plus what the current user may do with it, so the UI can hide what they can't. */
  @Get(':id')
  @RequireAccess('browse', ISSUE)
  async findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    const issue = await this.issuesService.findOne(id);
    const [permissions, visible] = await Promise.all([
      this.access.permissions(req.user, issue.projectId),
      this.access.browsableProjectIds(req.user),
    ]);
    const canDelete = permissions.canAdmin || (permissions.canEdit && issue.reporterId === req.user.id);
    // Don't reveal linked issues from projects this user can't see.
    const canSee = (projectId: string) => visible === null || visible.includes(projectId);
    return {
      ...issue,
      linksFrom: issue.linksFrom.filter((l) => canSee(l.target.projectId)),
      linksTo: issue.linksTo.filter((l) => canSee(l.source.projectId)),
      permissions: { ...permissions, canDelete },
    };
  }

  @Post()
  create(@Body() dto: CreateIssueDto, @Request() req: AuthRequest, @ProjectKey() projectKey?: string) {
    return this.issuesService.create(dto, req.user, projectKey);
  }

  @Patch(':id')
  @RequireAccess('edit', ISSUE)
  update(@Param('id') id: string, @Body() dto: UpdateIssueDto, @Request() req: AuthRequest) {
    return this.issuesService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @RequireAccess('browse', ISSUE)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.issuesService.remove(id, req.user);
  }

  @Post(':id/transition')
  @RequireAccess('edit', ISSUE)
  transition(@Param('id') id: string, @Body() dto: TransitionDto, @Request() req: AuthRequest) {
    return this.issuesService.transition(id, dto, req.user.id);
  }

  @Get(':id/history')
  @RequireAccess('browse', ISSUE)
  history(@Param('id') id: string) {
    return this.issuesService.getHistory(id);
  }

  // ─── Links ─────────────────────────────────────────────────────────────────

  @Post(':id/links')
  @RequireAccess('edit', ISSUE)
  createLink(@Param('id') id: string, @Body() dto: CreateLinkDto, @Request() req: AuthRequest) {
    return this.issuesService.createLink(id, dto, req.user);
  }

  @Delete(':id/links/:linkId')
  @RequireAccess('edit', ISSUE)
  removeLink(@Param('id') id: string, @Param('linkId') linkId: string, @Request() req: AuthRequest) {
    return this.issuesService.removeLink(id, linkId, req.user.id);
  }

  // ─── Comments (viewers may comment) ────────────────────────────────────────

  @Get(':id/comments')
  @RequireAccess('browse', ISSUE)
  getComments(@Param('id') id: string) {
    return this.issuesService.getComments(id);
  }

  @Post(':id/comments')
  @RequireAccess('browse', ISSUE)
  addComment(@Param('id') id: string, @Body() dto: CommentDto, @Request() req: AuthRequest) {
    return this.issuesService.addComment(id, req.user.id, dto.body);
  }

  @Patch(':id/comments/:commentId')
  @RequireAccess('browse', ISSUE)
  updateComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: CommentDto,
    @Request() req: AuthRequest,
  ) {
    return this.issuesService.updateComment(id, commentId, req.user, dto.body);
  }

  @Delete(':id/comments/:commentId')
  @RequireAccess('browse', ISSUE)
  deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @Request() req: AuthRequest) {
    return this.issuesService.deleteComment(id, commentId, req.user);
  }

  // ─── Watchers: anyone who can see the issue may watch it; adding others needs edit ─

  @Post(':id/watchers')
  @RequireAccess('browse', ISSUE)
  async addWatcher(@Param('id') id: string, @Body() dto: AddWatcherDto, @Request() req: AuthRequest) {
    const userId = dto.userId ?? req.user.id;
    if (userId !== req.user.id) await this.access.require(req.user, await this.access.projectOfIssue(id), 'edit');
    return this.issuesService.addWatcher(id, userId, req.user.id);
  }

  @Delete(':id/watchers/:userId')
  @RequireAccess('browse', ISSUE)
  async removeWatcher(@Param('id') id: string, @Param('userId') userId: string, @Request() req: AuthRequest) {
    if (userId !== req.user.id) await this.access.require(req.user, await this.access.projectOfIssue(id), 'edit');
    return this.issuesService.removeWatcher(id, userId);
  }

  // ─── Work logs ─────────────────────────────────────────────────────────────

  @Get(':id/worklogs')
  @RequireAccess('browse', ISSUE)
  getWorkLogs(@Param('id') id: string) {
    return this.issuesService.getWorkLogs(id);
  }

  @Post(':id/worklogs')
  @RequireAccess('edit', ISSUE)
  createWorkLog(@Param('id') id: string, @Body() dto: CreateWorkLogDto, @Request() req: AuthRequest) {
    return this.issuesService.createWorkLog(id, req.user.id, dto);
  }

  @Patch(':id/custom-fields')
  @RequireAccess('edit', ISSUE)
  updateCustomFields(@Param('id') id: string, @Body() dto: UpdateCustomFieldsDto) {
    return this.issuesService.updateCustomFields(id, dto.customFields);
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  @Post(':id/attachments')
  @RequireAccess('edit', ISSUE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected form field "file")');
    return this.issuesService.addAttachment(id, req.user.id, file);
  }

  @Get(':id/attachments/:attachmentId')
  @RequireAccess('browse', ISSUE)
  async getAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const attachment = await this.issuesService.getAttachment(id, attachmentId);
    const asciiName = attachment.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition':
        `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(fs.createReadStream(attachment.storagePath));
  }

  @Delete(':id/attachments/:attachmentId')
  @RequireAccess('edit', ISSUE)
  deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: AuthRequest,
  ) {
    return this.issuesService.deleteAttachment(id, attachmentId, req.user);
  }
}
