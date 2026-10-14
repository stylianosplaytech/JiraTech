import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard, LoginOnlyGuard, Roles, RolesGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { EDITABLE_FIELDS, PLACEHOLDER_KEYS, TRIGGER_EVENTS, TRIGGER_LABELS } from './automation-actions';
import { AutomationService } from './automation.service';

class RuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** A project key; leave out (or empty) for every project */
  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsString()
  event!: string;

  /** { fields?: string[] } or { toStatus?: string }, checked by the service */
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  jql?: string;

  /** Checked action by action by the service */
  @IsArray()
  actions!: unknown[];
}

class TestDto {
  /** Scheduled rules may leave it out to see which issues they would act on */
  @IsOptional()
  @IsString()
  issueKey?: string;
}

/** /automation — rules that react to issue events (global admins, logged in). Rules run with the access of the person who last saved them. */
@Controller('automation')
@UseGuards(JwtAuthGuard, LoginOnlyGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AutomationController {
  constructor(private automation: AutomationService) {}

  @Get('rules')
  list() {
    return this.automation.list();
  }

  /** What the rule editor offers: triggers, editable fields and placeholders */
  @Get('meta')
  meta() {
    return {
      triggers: TRIGGER_EVENTS.map((name) => ({ name, label: TRIGGER_LABELS[name] })),
      fields: EDITABLE_FIELDS,
      placeholders: PLACEHOLDER_KEYS,
    };
  }

  @Post('rules')
  create(@Request() req: { user: AuthUser }, @Body() dto: RuleDto) {
    return this.automation.create(dto, req.user);
  }

  @Put('rules/:id')
  update(@Request() req: { user: AuthUser }, @Param('id') id: string, @Body() dto: RuleDto) {
    return this.automation.update(id, dto, req.user);
  }

  @Delete('rules/:id')
  remove(@Param('id') id: string) {
    return this.automation.remove(id);
  }

  /** Dry run: what the rule would do to an issue */
  @Post('rules/:id/test')
  test(@Param('id') id: string, @Body() dto: TestDto) {
    return this.automation.test(id, dto.issueKey);
  }

  @Get('rules/:id/runs')
  runs(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.automation.runs(id, limit ? Number(limit) || 50 : 50);
  }
}
