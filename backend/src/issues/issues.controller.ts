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

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

@Controller('issues')
@UseGuards(JwtAuthGuard)
export class IssuesController {
  constructor(private issuesService: IssuesService) {}

  @Get()
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.issuesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateIssueDto, @Request() req: AuthRequest, @ProjectKey() projectKey?: string) {
    return this.issuesService.create(dto, req.user.id, projectKey);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIssueDto, @Request() req: AuthRequest) {
    return this.issuesService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.issuesService.remove(id, req.user);
  }

  @Post(':id/transition')
  transition(@Param('id') id: string, @Body() dto: TransitionDto, @Request() req: AuthRequest) {
    return this.issuesService.transition(id, dto, req.user.id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.issuesService.getHistory(id);
  }

  // ─── Links ─────────────────────────────────────────────────────────────────

  @Post(':id/links')
  createLink(@Param('id') id: string, @Body() dto: CreateLinkDto, @Request() req: AuthRequest) {
    return this.issuesService.createLink(id, dto, req.user.id);
  }

  @Delete(':id/links/:linkId')
  removeLink(@Param('id') id: string, @Param('linkId') linkId: string, @Request() req: AuthRequest) {
    return this.issuesService.removeLink(id, linkId, req.user.id);
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  @Get(':id/comments')
  getComments(@Param('id') id: string) {
    return this.issuesService.getComments(id);
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() dto: CommentDto, @Request() req: AuthRequest) {
    return this.issuesService.addComment(id, req.user.id, dto.body);
  }

  @Patch(':id/comments/:commentId')
  updateComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: CommentDto,
    @Request() req: AuthRequest,
  ) {
    return this.issuesService.updateComment(id, commentId, req.user, dto.body);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @Request() req: AuthRequest) {
    return this.issuesService.deleteComment(id, commentId, req.user);
  }

  // ─── Watchers ──────────────────────────────────────────────────────────────

  @Post(':id/watchers')
  addWatcher(@Param('id') id: string, @Body() dto: AddWatcherDto, @Request() req: AuthRequest) {
    return this.issuesService.addWatcher(id, dto.userId ?? req.user.id);
  }

  @Delete(':id/watchers/:userId')
  removeWatcher(@Param('id') id: string, @Param('userId') userId: string) {
    return this.issuesService.removeWatcher(id, userId);
  }

  // ─── Work logs ─────────────────────────────────────────────────────────────

  @Get(':id/worklogs')
  getWorkLogs(@Param('id') id: string) {
    return this.issuesService.getWorkLogs(id);
  }

  @Post(':id/worklogs')
  createWorkLog(@Param('id') id: string, @Body() dto: CreateWorkLogDto, @Request() req: AuthRequest) {
    return this.issuesService.createWorkLog(id, req.user.id, dto);
  }

  @Patch(':id/custom-fields')
  updateCustomFields(@Param('id') id: string, @Body() dto: UpdateCustomFieldsDto) {
    return this.issuesService.updateCustomFields(id, dto.customFields);
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  @Post(':id/attachments')
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
  deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Request() req: AuthRequest,
  ) {
    return this.issuesService.deleteAttachment(id, attachmentId, req.user);
  }
}
