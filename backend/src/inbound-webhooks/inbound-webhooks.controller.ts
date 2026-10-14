import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { IssueType, Priority } from '@prisma/client';
import { JwtAuthGuard, LoginOnlyGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { InboundWebhooksService } from './inbound-webhooks.service';
import { InboundWebhookDto, TestPayloadDto } from './inbound-webhooks.dto';

type Req = { user: AuthUser };

/**
 * /inbound-webhooks — setting up the addresses other systems send events to. Global administrators manage all of them; project
 * administrators the ones of their own projects. Needs a login: API tokens cannot manage them.
 */
@Controller('inbound-webhooks')
@UseGuards(JwtAuthGuard, LoginOnlyGuard)
export class InboundWebhooksController {
  constructor(private hooks: InboundWebhooksService) {}

  /** The incoming webhooks the signed-in user may manage */
  @Get()
  list(@Request() req: Req) {
    return this.hooks.list(req.user);
  }

  /** What the editor offers */
  @Get('meta')
  meta() {
    return { issueTypes: Object.values(IssueType), priorities: Object.values(Priority) };
  }

  @Post()
  create(@Request() req: Req, @Body() dto: InboundWebhookDto) {
    return this.hooks.create(dto, req.user);
  }

  @Put(':id')
  update(@Request() req: Req, @Param('id') id: string, @Body() dto: InboundWebhookDto) {
    return this.hooks.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Request() req: Req, @Param('id') id: string) {
    return this.hooks.remove(id, req.user);
  }

  /** A new address (the old one stops working); returned once */
  @Post(':id/rotate-token')
  rotate(@Request() req: Req, @Param('id') id: string) {
    return this.hooks.rotateToken(id, req.user);
  }

  /** What a sample payload would do, without doing it */
  @Post(':id/test')
  @HttpCode(200)
  test(@Request() req: Req, @Param('id') id: string, @Body() dto: TestPayloadDto) {
    return this.hooks.test(id, req.user, dto.payload);
  }

  @Get(':id/deliveries')
  deliveries(@Request() req: Req, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.hooks.deliveries(id, req.user, limit ? Number(limit) || 50 : 50);
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
  @ApiBody({ description: 'Any JSON object: it is turned into an issue by the webhook\'s templates', schema: { type: 'object', additionalProperties: true } })
  receive(@Param('token') token: string, @Body() body: unknown) {
    return this.hooks.receive(token, body);
  }
}
