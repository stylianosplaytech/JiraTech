import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, LoginOnlyGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { EVENT_LABELS, WEBHOOK_EVENTS } from './webhook-events';
import { WebhooksService } from './webhooks.service';
import { WebhookDto } from './webhooks.dto';

type Req = { user: AuthUser };

/**
 * /webhooks — where Conductor sends signed events. Global administrators manage all of them; project administrators the ones
 * of their own projects (they can't make one for every project). Needs a login: API tokens cannot manage webhooks.
 */
@Controller('webhooks')
@UseGuards(JwtAuthGuard, LoginOnlyGuard)
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  /** The webhooks the signed-in user may manage */
  @Get()
  list(@Request() req: Req) {
    return this.webhooks.list(req.user);
  }

  /** The events a webhook can subscribe to */
  @Get('events')
  events() {
    return WEBHOOK_EVENTS.map((name) => ({ name, label: EVENT_LABELS[name] }));
  }

  @Post()
  create(@Request() req: Req, @Body() dto: WebhookDto) {
    return this.webhooks.create(dto, req.user);
  }

  @Get(':id')
  get(@Request() req: Req, @Param('id') id: string) {
    return this.webhooks.get(id, req.user);
  }

  @Put(':id')
  update(@Request() req: Req, @Param('id') id: string, @Body() dto: WebhookDto) {
    return this.webhooks.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Request() req: Req, @Param('id') id: string) {
    return this.webhooks.remove(id, req.user);
  }

  /** A new signing secret (the old one stops working); returned once */
  @Post(':id/rotate-secret')
  rotate(@Request() req: Req, @Param('id') id: string) {
    return this.webhooks.rotateSecret(id, req.user);
  }

  /** Sends a sample event and returns how it went */
  @Post(':id/test')
  test(@Request() req: Req, @Param('id') id: string) {
    return this.webhooks.test(id, req.user);
  }

  @Get(':id/deliveries')
  deliveries(@Request() req: Req, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.webhooks.deliveries(id, req.user, limit ? Number(limit) || 50 : 50);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  redeliver(@Request() req: Req, @Param('id') id: string, @Param('deliveryId') deliveryId: string) {
    return this.webhooks.redeliver(id, deliveryId, req.user);
  }
}
