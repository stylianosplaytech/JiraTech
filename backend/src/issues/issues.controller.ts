import {

  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,

  UseInterceptors, UploadedFile, Res, StreamableFile,

} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import { IssueStatus, IssueType } from '@prisma/client';

import { Response } from 'express';

import * as fs from 'fs';

import { IssuesService } from './issues.service';

import {

  CreateIssueDto, UpdateIssueDto, TransitionDto, CreateLinkDto,

  AddWatcherDto, CreateWorkLogDto, UpdateCustomFieldsDto,

} from './dto/issue.dto';

import { JwtAuthGuard } from '../auth/guards';



@Controller('issues')

@UseGuards(JwtAuthGuard)

export class IssuesController {

  constructor(private issuesService: IssuesService) {}



  @Get()

  findAll(

    @Query('type') type?: IssueType,

    @Query('status') status?: IssueStatus,

    @Query('parentId') parentId?: string,

    @Query('sprintId') sprintId?: string,

    @Query('piId') piId?: string,

    @Query('assigneeId') assigneeId?: string,

    @Query('epicName') epicName?: string,

    @Query('search') search?: string,

  ) {

    return this.issuesService.findAll({ type, status, parentId, sprintId, piId, assigneeId, epicName, search });

  }



  @Get(':id')

  findOne(@Param('id') id: string) {

    return this.issuesService.findOne(id);

  }



  @Post()

  create(@Body() dto: CreateIssueDto, @Request() req: { user: { id: string } }) {

    return this.issuesService.create(dto, req.user.id);

  }



  @Patch(':id')

  update(@Param('id') id: string, @Body() dto: UpdateIssueDto) {

    return this.issuesService.update(id, dto);

  }



  @Post(':id/transition')

  transition(@Param('id') id: string, @Body() dto: TransitionDto) {

    return this.issuesService.transition(id, dto);

  }



  @Post(':id/links')

  createLink(@Param('id') id: string, @Body() dto: CreateLinkDto) {

    return this.issuesService.createLink(id, dto);

  }



  @Post(':id/watchers')

  addWatcher(

    @Param('id') id: string,

    @Body() dto: AddWatcherDto,

    @Request() req: { user: { id: string } },

  ) {

    const userId = dto.userId ?? req.user.id;

    return this.issuesService.addWatcher(id, userId);

  }



  @Delete(':id/watchers/:userId')

  removeWatcher(@Param('id') id: string, @Param('userId') userId: string) {

    return this.issuesService.removeWatcher(id, userId);

  }



  @Get(':id/worklogs')

  getWorkLogs(@Param('id') id: string) {

    return this.issuesService.getWorkLogs(id);

  }



  @Post(':id/worklogs')

  createWorkLog(

    @Param('id') id: string,

    @Body() dto: CreateWorkLogDto,

    @Request() req: { user: { id: string } },

  ) {

    return this.issuesService.createWorkLog(id, req.user.id, dto);

  }



  @Patch(':id/custom-fields')

  updateCustomFields(@Param('id') id: string, @Body() dto: UpdateCustomFieldsDto) {

    return this.issuesService.updateCustomFields(id, dto.customFields);

  }



  @Post(':id/attachments')

  @UseInterceptors(FileInterceptor('file'))

  addAttachment(

    @Param('id') id: string,

    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },

    @Request() req: { user: { id: string } },

  ) {

    return this.issuesService.addAttachment(id, req.user.id, {

      originalname: file.originalname,

      mimetype: file.mimetype,

      size: file.size,

      buffer: file.buffer,

    });

  }



  @Get(':id/attachments/:attachmentId')

  async getAttachment(

    @Param('id') id: string,

    @Param('attachmentId') attachmentId: string,

    @Res({ passthrough: true }) res: Response,

  ) {

    const attachment = await this.issuesService.getAttachment(id, attachmentId);

    res.set({

      'Content-Type': attachment.mimeType,

      'Content-Disposition': `inline; filename="${attachment.filename}"`,

    });

    const file = fs.createReadStream(attachment.storagePath);

    return new StreamableFile(file);

  }

}


