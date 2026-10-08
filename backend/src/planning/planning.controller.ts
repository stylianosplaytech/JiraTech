import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { CreatePiDto, CreateSprintDto, WorkBreakdownDto } from './dto/planning.dto';
import { JwtAuthGuard } from '../auth/guards';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('planning')
@UseGuards(JwtAuthGuard)
export class PlanningController {
  constructor(private planningService: PlanningService) {}

  @Get('pis')
  getPis(@ProjectKey() projectKey?: string) {
    return this.planningService.getPis(projectKey);
  }

  @Post('pis')
  createPi(@Body() dto: CreatePiDto, @ProjectKey() projectKey?: string) {
    return this.planningService.createPi(dto, projectKey);
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
