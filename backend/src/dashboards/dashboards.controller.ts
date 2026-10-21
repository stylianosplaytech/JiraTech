import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { DashboardsService } from './dashboards.service';
import {
  CreateDashboardDto, CreateGadgetDto, ReorderGadgetsDto, UpdateDashboardDto, UpdateGadgetDto,
} from './dashboards.dto';

/** Dashboards people build themselves from their saved filters. */
@Controller('dashboards')
@UseGuards(JwtAuthGuard)
export class DashboardsController {
  constructor(private dashboards: DashboardsService) {}

  /** Your dashboards and the ones shared with you. */
  @Get()
  list(@Request() req: AuthRequest) {
    return this.dashboards.list(req.user);
  }

  @Post()
  create(@Body() dto: CreateDashboardDto, @Request() req: AuthRequest) {
    return this.dashboards.create(dto, req.user);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.dashboards.get(id, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDashboardDto, @Request() req: AuthRequest) {
    return this.dashboards.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.dashboards.remove(id, req.user);
  }

  /** Save a private copy of a dashboard you can see. */
  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.dashboards.duplicate(id, req.user);
  }

  @Post(':id/gadgets')
  addGadget(@Param('id') id: string, @Body() dto: CreateGadgetDto, @Request() req: AuthRequest) {
    return this.dashboards.addGadget(id, dto, req.user);
  }

  /** Set the order of the gadgets: every gadget id on the dashboard, once. */
  @Put(':id/gadgets/order')
  reorder(@Param('id') id: string, @Body() dto: ReorderGadgetsDto, @Request() req: AuthRequest) {
    return this.dashboards.reorder(id, dto.ids, req.user);
  }

  @Patch(':id/gadgets/:gadgetId')
  updateGadget(@Param('id') id: string, @Param('gadgetId') gadgetId: string, @Body() dto: UpdateGadgetDto, @Request() req: AuthRequest) {
    return this.dashboards.updateGadget(id, gadgetId, dto, req.user);
  }

  @Delete(':id/gadgets/:gadgetId')
  removeGadget(@Param('id') id: string, @Param('gadgetId') gadgetId: string, @Request() req: AuthRequest) {
    return this.dashboards.removeGadget(id, gadgetId, req.user);
  }

  /** What a gadget shows now, worked out for you from its saved filter. */
  @Get(':id/gadgets/:gadgetId/data')
  gadgetData(@Param('id') id: string, @Param('gadgetId') gadgetId: string, @Request() req: AuthRequest) {
    return this.dashboards.gadgetData(id, gadgetId, req.user);
  }
}
