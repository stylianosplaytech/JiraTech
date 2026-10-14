import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, LoginOnlyGuard, Roles, RolesGuard } from '../auth/guards';
import { AuthUser } from '../common/auth-user';
import { EVENT_LABELS, WEBHOOK_EVENTS } from './webhook-events';
import { WebhooksService } from './webhooks.service';
import { WebhookDto } from './webhooks.dto';

/** /webhooks — where JiraTech sends signed events (global admins, logged in). */
@Controller('webhooks')
@UseGuards(JwtAuthGuard, LoginOnlyGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  @Get()
  list() {
    return this.webhooks.list();
  }

  /** The events a webhook can subscribe to */
  @Get('events')
  events() {
    return WEBHOOK_EVENTS.map((name) => ({ name, label: EVENT_LABELS[name] }));
  }

  @Post()
  create(@Request() req: { user: AuthUser }, @Body() dto: WebhookDto) {
    return this.webhooks.create(dto, req.user.id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.webhooks.get(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: WebhookDto) {
    return this.webhooks.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.webhooks.remove(id);
  }

  /** A new signing secret (the old one stops working); returned once */
  @Post(':id/rotate-secret')
  rotate(@Param('id') id: string) {
    return this.webhooks.rotateSecret(id);
  }

  /** Sends a sample event and returns how it went */
  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.webhooks.test(id);
  }

  @Get(':id/deliveries')
  deliveries(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.webhooks.deliveries(id, limit ? Number(limit) || 50 : 50);
  }

  @Post(':id/deliveries/:deliveryId/redeliver')
  redeliver(@Param('id') id: string, @Param('deliveryId') deliveryId: string) {
    return this.webhooks.redeliver(id, deliveryId);
  }
}
