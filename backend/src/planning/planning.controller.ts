import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { CreatePiDto, CreateSprintDto, WorkBreakdownDto } from './dto/planning.dto';
import { JwtAuthGuard } from '../auth/guards';

@Controller('planning')
@UseGuards(JwtAuthGuard)
export class PlanningController {
  constructor(private planningService: PlanningService) {}

  @Get('pis')
  getPis() {
    return this.planningService.getPis();
  }

  @Post('pis')
  createPi(@Body() dto: CreatePiDto) {
    return this.planningService.createPi(dto);
  }

  @Post('sprints')
  createSprint(@Body() dto: CreateSprintDto) {
    return this.planningService.createSprint(dto);
  }

  @Post('work-breakdown')
  workBreakdown(@Body() dto: WorkBreakdownDto, @Request() req: { user: { id: string } }) {
    return this.planningService.workBreakdown(dto, req.user.id);
  }
}
