import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Request, UseGuards,
} from '@nestjs/common';
import { AllowCustomers, JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { AuthRequest } from '../common/auth-user';
import { ServiceDeskService } from './service-desk.service';
import {
  PortalCommentDto, PortalRequestDto, PortalSettingsDto, QueueDto, RequestTypeDto, SlaTargetsDto,
  UpdateQueueDto, UpdateRequestTypeDto,
} from './dto/service-desk.dto';

const PROJECT = { from: 'projectParam', param: 'key' } as const;
const ISSUE = { from: 'issueParam', param: 'id' } as const;

/** /service-desk — agents work queues and see SLAs; project admins configure the service desk. */
@Controller('service-desk')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ServiceDeskController {
  constructor(private serviceDesk: ServiceDeskService) {}

  @Get('requests/:id')
  @RequireAccess('browse', ISSUE)
  requestInfo(@Param('id') id: string) {
    return this.serviceDesk.requestInfo(id);
  }

  @Get(':key')
  @RequireAccess('browse', PROJECT)
  settings(@Param('key') key: string) {
    return this.serviceDesk.settings(key);
  }

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

  @Get(':key/customers')
  @RequireAccess('browse', PROJECT)
  customers(@Param('key') key: string) {
    return this.serviceDesk.customers(key);
  }

  @Patch(':key/portal')
  @RequireAccess('admin', PROJECT)
  setPortal(@Param('key') key: string, @Body() dto: PortalSettingsDto) {
    return this.serviceDesk.setPortalOpen(key, dto.portalOpen);
  }

  @Put(':key/customers/:userId')
  @RequireAccess('admin', PROJECT)
  addCustomer(@Param('key') key: string, @Param('userId') userId: string) {
    return this.serviceDesk.addCustomer(key, userId);
  }

  @Delete(':key/customers/:userId')
  @RequireAccess('admin', PROJECT)
  removeCustomer(@Param('key') key: string, @Param('userId') userId: string) {
    return this.serviceDesk.removeCustomer(key, userId);
  }
}

/** /portal — the help center. Open to customers; access is checked per service desk and per request. */
@Controller('portal')
@UseGuards(JwtAuthGuard)
@AllowCustomers()
export class PortalController {
  constructor(private serviceDesk: ServiceDeskService) {}

  @Get('desks')
  desks(@Request() req: AuthRequest) {
    return this.serviceDesk.portalDesks(req.user);
  }

  @Get('desks/:key')
  desk(@Param('key') key: string, @Request() req: AuthRequest) {
    return this.serviceDesk.portalDesk(key, req.user);
  }

  @Post('desks/:key/requests')
  raise(@Param('key') key: string, @Body() dto: PortalRequestDto, @Request() req: AuthRequest) {
    return this.serviceDesk.raise(key, dto, req.user);
  }

  @Get('requests')
  myRequests(@Request() req: AuthRequest, @Query('status') status?: string, @Query('q') q?: string) {
    return this.serviceDesk.myRequests(req.user, { status, q });
  }

  @Get('requests/:key')
  request(@Param('key') key: string, @Request() req: AuthRequest) {
    return this.serviceDesk.request(key, req.user);
  }

  @Post('requests/:key/comments')
  comment(@Param('key') key: string, @Body() dto: PortalCommentDto, @Request() req: AuthRequest) {
    return this.serviceDesk.portalComment(key, req.user, dto.body);
  }
}
