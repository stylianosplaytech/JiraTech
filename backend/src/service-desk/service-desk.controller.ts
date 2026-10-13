import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AllowCustomers, JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { AuthRequest } from '../common/auth-user';
import { ServiceDeskService } from './service-desk.service';
import { PortalsService } from './portals.service';
import { EmailChannelService } from './email-channel.service';
import {
  CreatePortalDto, EmailChannelDto, PortalCommentDto, PortalRequestDto, QueueDto, RequestOrganizationDto, RequestTypeDto, SlaTargetsDto, TestEmailDto,
  UpdatePortalDto, UpdateQueueDto, UpdateRequestTypeDto,
} from './dto/service-desk.dto';

const PROJECT = { from: 'projectParam', param: 'key' } as const;
const ISSUE = { from: 'issueParam', param: 'id' } as const;

/** /service-desk — agents work queues and see SLAs; project admins configure the service desk, its portals and its email address. */
@Controller('service-desk')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ServiceDeskController {
  constructor(private serviceDesk: ServiceDeskService, private portals: PortalsService, private email: EmailChannelService) {}

  @Get('requests/:id')
  @RequireAccess('browse', ISSUE)
  requestInfo(@Param('id') id: string) {
    return this.serviceDesk.requestInfo(id);
  }

  @Patch('requests/:id/organization')
  @RequireAccess('edit', ISSUE)
  setRequestOrganization(@Param('id') id: string, @Body() dto: RequestOrganizationDto, @Request() req: AuthRequest) {
    return this.portals.setRequestOrganization(id, dto.organizationId ?? null, req.user.id);
  }

  @Get(':key')
  @RequireAccess('browse', PROJECT)
  settings(@Param('key') key: string) {
    return this.serviceDesk.settings(key);
  }

  // ─── Queues ────────────────────────────────────────────────────────────────

  @Get(':key/queues')
  @RequireAccess('browse', PROJECT)
  queues(@Param('key') key: string, @Request() req: AuthRequest) {
    return this.serviceDesk.queues(key, req.user);
  }

  @Get(':key/queues/:queueId/issues')
  @RequireAccess('browse', PROJECT)
  queueIssues(
    @Param('key') key: string,
    @Param('queueId') queueId: string,
    @Request() req: AuthRequest,
    @Query('startAt') startAt?: string,
    @Query('maxResults') maxResults?: string,
  ) {
    return this.serviceDesk.queueIssues(key, queueId, req.user, Number(startAt) || 0, Number(maxResults) || 50);
  }

  @Post(':key/queues')
  @RequireAccess('admin', PROJECT)
  createQueue(@Param('key') key: string, @Body() dto: QueueDto, @Request() req: AuthRequest) {
    return this.serviceDesk.createQueue(key, dto, req.user);
  }

  @Patch(':key/queues/:queueId')
  @RequireAccess('admin', PROJECT)
  updateQueue(@Param('key') key: string, @Param('queueId') queueId: string, @Body() dto: UpdateQueueDto, @Request() req: AuthRequest) {
    return this.serviceDesk.updateQueue(key, queueId, dto, req.user);
  }

  @Delete(':key/queues/:queueId')
  @RequireAccess('admin', PROJECT)
  deleteQueue(@Param('key') key: string, @Param('queueId') queueId: string) {
    return this.serviceDesk.deleteQueue(key, queueId);
  }

  // ─── Request types and SLAs ────────────────────────────────────────────────

  @Post(':key/request-types')
  @RequireAccess('admin', PROJECT)
  createRequestType(@Param('key') key: string, @Body() dto: RequestTypeDto) {
    return this.serviceDesk.createRequestType(key, dto);
  }

  @Patch(':key/request-types/:typeId')
  @RequireAccess('admin', PROJECT)
  updateRequestType(@Param('key') key: string, @Param('typeId') typeId: string, @Body() dto: UpdateRequestTypeDto) {
    return this.serviceDesk.updateRequestType(key, typeId, dto);
  }

  @Delete(':key/request-types/:typeId')
  @RequireAccess('admin', PROJECT)
  deleteRequestType(@Param('key') key: string, @Param('typeId') typeId: string) {
    return this.serviceDesk.deleteRequestType(key, typeId);
  }

  @Put(':key/sla')
  @RequireAccess('admin', PROJECT)
  setSla(@Param('key') key: string, @Body() dto: SlaTargetsDto) {
    return this.serviceDesk.setSlaTargets(key, dto.targets);
  }

  // ─── Portals ───────────────────────────────────────────────────────────────

  @Get(':key/portals')
  @RequireAccess('browse', PROJECT)
  listPortals(@Param('key') key: string) {
    return this.portals.list(key);
  }

  @Post(':key/portals')
  @RequireAccess('admin', PROJECT)
  createPortal(@Param('key') key: string, @Body() dto: CreatePortalDto) {
    return this.portals.create(key, dto);
  }

  @Patch(':key/portals/:portalId')
  @RequireAccess('admin', PROJECT)
  updatePortal(@Param('key') key: string, @Param('portalId') portalId: string, @Body() dto: UpdatePortalDto) {
    return this.portals.update(key, portalId, dto);
  }

  @Delete(':key/portals/:portalId')
  @RequireAccess('admin', PROJECT)
  deletePortal(@Param('key') key: string, @Param('portalId') portalId: string) {
    return this.portals.remove(key, portalId);
  }

  @Put(':key/portals/:portalId/organizations/:organizationId')
  @RequireAccess('admin', PROJECT)
  addPortalOrganization(@Param('key') key: string, @Param('portalId') portalId: string, @Param('organizationId') organizationId: string) {
    return this.portals.addOrganization(key, portalId, organizationId);
  }

  @Delete(':key/portals/:portalId/organizations/:organizationId')
  @RequireAccess('admin', PROJECT)
  removePortalOrganization(@Param('key') key: string, @Param('portalId') portalId: string, @Param('organizationId') organizationId: string) {
    return this.portals.removeOrganization(key, portalId, organizationId);
  }

  @Put(':key/portals/:portalId/customers/:userId')
  @RequireAccess('admin', PROJECT)
  addPortalCustomer(@Param('key') key: string, @Param('portalId') portalId: string, @Param('userId') userId: string) {
    return this.portals.addCustomer(key, portalId, userId);
  }

  @Delete(':key/portals/:portalId/customers/:userId')
  @RequireAccess('admin', PROJECT)
  removePortalCustomer(@Param('key') key: string, @Param('portalId') portalId: string, @Param('userId') userId: string) {
    return this.portals.removeCustomer(key, portalId, userId);
  }

  @Delete(':key/portals/:portalId/exclusions/:userId')
  @RequireAccess('admin', PROJECT)
  removePortalExclusion(@Param('key') key: string, @Param('portalId') portalId: string, @Param('userId') userId: string) {
    return this.portals.removeExclusion(key, portalId, userId);
  }

  // ─── Email channel ─────────────────────────────────────────────────────────

  @Get(':key/email')
  @RequireAccess('browse', PROJECT)
  emailChannel(@Param('key') key: string) {
    return this.email.get(key);
  }

  @Put(':key/email')
  @RequireAccess('admin', PROJECT)
  saveEmailChannel(@Param('key') key: string, @Body() dto: EmailChannelDto) {
    return this.email.save(key, dto);
  }

  @Delete(':key/email')
  @RequireAccess('admin', PROJECT)
  removeEmailChannel(@Param('key') key: string) {
    return this.email.remove(key);
  }

  @Get(':key/email/messages')
  @RequireAccess('browse', PROJECT)
  emailMessages(@Param('key') key: string) {
    return this.email.messages(key);
  }

  @Post(':key/email/test-connection')
  @RequireAccess('admin', PROJECT)
  testEmailConnection(@Param('key') key: string) {
    return this.email.testConnection(key);
  }

  @Post(':key/email/check')
  @RequireAccess('admin', PROJECT)
  checkEmail(@Param('key') key: string) {
    return this.email.checkNow(key);
  }

  @Post(':key/email/test-email')
  @RequireAccess('admin', PROJECT)
  sendTestEmail(@Param('key') key: string, @Body() dto: TestEmailDto) {
    return this.email.testEmail(key, dto);
  }
}

/** /users/:userId/portals — global admins choose a customer's portals from the People page. */
@Controller('users/:userId/portals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CustomerPortalsController {
  constructor(private portals: PortalsService) {}

  @Get()
  list(@Param('userId') userId: string) {
    return this.portals.customerPortals(userId);
  }

  @Put(':portalId')
  allow(@Param('userId') userId: string, @Param('portalId') portalId: string) {
    return this.portals.allowCustomerPortal(userId, portalId);
  }

  @Delete(':portalId')
  remove(@Param('userId') userId: string, @Param('portalId') portalId: string) {
    return this.portals.removeCustomerPortal(userId, portalId);
  }
}

/** /portal — the help centers. Open to customers; access is checked per portal and per request. */
@Controller('portal')
@UseGuards(JwtAuthGuard)
@AllowCustomers()
export class PortalController {
  constructor(private portals: PortalsService) {}

  @Get('portals')
  mine(@Request() req: AuthRequest) {
    return this.portals.mine(req.user);
  }

  @Get('portals/:slug')
  portal(@Param('slug') slug: string, @Request() req: AuthRequest) {
    return this.portals.portal(slug, req.user);
  }

  @Post('portals/:slug/requests')
  raise(@Param('slug') slug: string, @Body() dto: PortalRequestDto, @Request() req: AuthRequest) {
    return this.portals.raise(slug, dto, req.user);
  }

  @Get('requests')
  myRequests(@Request() req: AuthRequest, @Query('status') status?: string, @Query('q') q?: string) {
    return this.portals.myRequests(req.user, { status, q });
  }

  @Get('requests/:key')
  request(@Param('key') key: string, @Request() req: AuthRequest) {
    return this.portals.request(key, req.user);
  }

  @Post('requests/:key/share')
  share(@Param('key') key: string, @Body() dto: RequestOrganizationDto, @Request() req: AuthRequest) {
    return this.portals.share(key, req.user, dto.organizationId ?? null);
  }

  @Post('requests/:key/comments')
  comment(@Param('key') key: string, @Body() dto: PortalCommentDto, @Request() req: AuthRequest) {
    return this.portals.comment(key, req.user, dto.body);
  }
}
