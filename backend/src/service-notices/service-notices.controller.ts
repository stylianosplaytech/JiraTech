import { Body, Controller, Delete, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthRequest } from '../common/auth-user';
import { ServiceNoticesService } from './service-notices.service';
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
