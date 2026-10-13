import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import type { AuthRequest } from '../common/auth-user';
import { IssueEmailService } from './issue-email.service';
import { EmailTemplatesService } from './email-templates.service';
import { EmailTemplateDto, RenderTemplateDto, SendEmailDto } from './dto';

const ISSUE = { from: 'issueParam', param: 'id' } as const;

/** /issues/:id/emails — the emails on a service desk request, and writing new ones (agents who can see it). */
@Controller('issues/:id/emails')
@UseGuards(JwtAuthGuard, AccessGuard)
export class IssueEmailController {
  constructor(private emails: IssueEmailService) {}

  @Get()
  @RequireAccess('browse', ISSUE)
  list(@Param('id') id: string) {
    return this.emails.list(id);
  }

  @Post()
  @RequireAccess('browse', ISSUE)
  send(@Param('id') id: string, @Body() dto: SendEmailDto, @Request() req: AuthRequest) {
    return this.emails.send(id, req.user, dto);
  }

  @Post('render-template')
  @RequireAccess('browse', ISSUE)
  render(@Param('id') id: string, @Body() dto: RenderTemplateDto, @Request() req: AuthRequest) {
    return this.emails.renderTemplate(id, req.user, dto.templateId, dto.to);
  }

  @Post(':emailId/retry')
  @RequireAccess('browse', ISSUE)
  retry(@Param('id') id: string, @Param('emailId') emailId: string, @Request() req: AuthRequest) {
    return this.emails.retry(id, emailId, req.user);
  }
}

/** /email-templates — global templates (admins) and each service desk's own (its project admins). */
@Controller('email-templates')
@UseGuards(JwtAuthGuard)
export class EmailTemplatesController {
  constructor(private templates: EmailTemplatesService) {}

  @Get()
  list(@Request() req: AuthRequest, @Query('project') project?: string, @Query('scope') scope?: string) {
    return this.templates.list(req.user, project || undefined, scope === 'global' || scope === 'project' ? scope : undefined);
  }

  @Post()
  create(@Body() dto: EmailTemplateDto, @Request() req: AuthRequest) {
    return this.templates.create(req.user, dto);
  }

  @Put(':templateId')
  update(@Param('templateId') id: string, @Body() dto: EmailTemplateDto, @Request() req: AuthRequest) {
    return this.templates.update(req.user, id, dto);
  }

  @Delete(':templateId')
  remove(@Param('templateId') id: string, @Request() req: AuthRequest) {
    return this.templates.remove(req.user, id);
  }
}
