import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('scheduling')
@UseGuards(JwtAuthGuard)
export class SchedulingController {
  constructor(private schedulingService: SchedulingService) {}

  @Post('run')
  run(@Body() body: { piId: string; teamCapacity?: Record<string, number> }) {
    return this.schedulingService.runSchedule(body.piId, body.teamCapacity);
  }

  @Post('baseline')
  captureBaseline(@Body() body: { piId: string; name: string; capturedBy?: string }) {
    return this.schedulingService.captureBaseline(body.piId, body.name, body.capturedBy);
  }

  @Get('baselines/:piId')
  getBaselines(@Param('piId') piId: string) {
    return this.schedulingService.getBaselines(piId);
  }
}
