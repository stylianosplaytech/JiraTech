import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Request, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthRequest } from '../common/auth-user';
import { MAX_FILE_BYTES, ServiceNoticesService } from './service-notices.service';
import { NoticeTemplateDto, PreviewNoticeDto, SendNoticeDto } from './dto';

/** /notice-templates — staff pick from them; global admins change them. */
@Controller('notice-templates')
@UseGuards(JwtAuthGuard)
export class NoticeTemplatesController {
  constructor(private notices: ServiceNoticesService) {}

  @Get()
  list() {
    return this.notices.templates();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.notices.template(id);
  }

  @Post()
  create(@Body() dto: NoticeTemplateDto, @Request() req: AuthRequest) {
    return this.notices.createTemplate(req.user, dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: NoticeTemplateDto, @Request() req: AuthRequest) {
    return this.notices.updateTemplate(req.user, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.notices.removeTemplate(req.user, id);
  }
}

/** /service-notices — the notices staff have sent, and sending new ones. */
@Controller('service-notices')
@UseGuards(JwtAuthGuard)
export class ServiceNoticesController {
  constructor(private notices: ServiceNoticesService) {}

  @Get()
  list() {
    return this.notices.list();
  }

  /** A file to send with a notice being written (form field "file") */
  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(@UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, @Request() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded (expected form field "file")');
    return this.notices.uploadFile(req.user, file);
  }

  @Get('files/:fileId')
  async download(@Param('fileId') fileId: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.notices.file(fileId);
    const asciiName = file.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(fs.createReadStream(file.storagePath));
  }

  @Delete('files/:fileId')
  removeFile(@Param('fileId') fileId: string) {
    return this.notices.removeFile(fileId);
  }

  @Post('preview')
  preview(@Body() dto: PreviewNoticeDto) {
    return this.notices.preview(dto.content);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.notices.get(id);
  }

  @Post()
  send(@Body() dto: SendNoticeDto, @Request() req: AuthRequest) {
    return this.notices.send(req.user, dto);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.notices.retry(id);
  }
}
