import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { IssueType, Priority, UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard, LoginOnlyGuard, Roles, RolesGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { InboundWebhooksService } from './inbound-webhooks.service';

class InboundWebhookDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  projectKey!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  issueType?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  priorityFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  dedupe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolvePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolveEquals?: string;

  @IsOptional()
  @IsBoolean()
  includePayload?: boolean;
}

class TestPayloadDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

/** /inbound-webhooks — setting up the addresses other systems send events to (global admins, logged in). */
@Controller('inbound-webhooks')
@UseGuards(JwtAuthGuard, LoginOnlyGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class InboundWebhooksController {
  constructor(private hooks: InboundWebhooksService) {}

  @Get()
  list() {
    return this.hooks.list();
  }

  /** What the editor offers */
  @Get('meta')
  meta() {
    return { issueTypes: Object.values(IssueType), priorities: Object.values(Priority) };
  }

  @Post()
  create(@Request() req: { user: AuthUser }, @Body() dto: InboundWebhookDto) {
    return this.hooks.create(dto, req.user);
  }

  @Put(':id')
  update(@Request() req: { user: AuthUser }, @Param('id') id: string, @Body() dto: InboundWebhookDto) {
    return this.hooks.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.hooks.remove(id);
  }

  /** A new address (the old one stops working); returned once */
  @Post(':id/rotate-token')
  rotate(@Param('id') id: string) {
    return this.hooks.rotateToken(id);
  }

  /** What a sample payload would do, without doing it */
  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string, @Body() dto: TestPayloadDto) {
    return this.hooks.test(id, dto.payload);
  }

  @Get(':id/deliveries')
  deliveries(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.hooks.deliveries(id, limit ? Number(limit) || 50 : 50);
  }
}

/**
 * POST /hooks/:token — where other systems send events. No login: the secret address is the credential. Anything wrong
 * with it answers 404, and a webhook can't be told from a missing one.
 */
@Controller('hooks')
export class HooksController {
  constructor(private hooks: InboundWebhooksService) {}

  @Post(':token')
  @HttpCode(200)
  receive(@Param('token') token: string, @Body() body: unknown) {
    return this.hooks.receive(token, body);
  }
}
