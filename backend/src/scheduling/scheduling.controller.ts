import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';

@Controller('scheduling')
@UseGuards(JwtAuthGuard, AccessGuard)
export class SchedulingController {
  constructor(private schedulingService: SchedulingService) {}

  @Post('run')
  @RequireAccess('edit', { from: 'piBody', field: 'piId' })
  run(@Body() body: { piId: string; teamCapacity?: Record<string, number> }) {
    return this.schedulingService.runSchedule(body.piId, body.teamCapacity);
  }

  @Post('baseline')
  @RequireAccess('edit', { from: 'piBody', field: 'piId' })
  captureBaseline(@Body() body: { piId: string; name: string; capturedBy?: string }) {
    return this.schedulingService.captureBaseline(body.piId, body.name, body.capturedBy);
  }

  @Get('baselines/:piId')
  @RequireAccess('browse', { from: 'piParam', param: 'piId' })
  getBaselines(@Param('piId') piId: string) {
    return this.schedulingService.getBaselines(piId);
  }
}
