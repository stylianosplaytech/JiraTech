import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { CreatePiDto, CreateSprintDto, WorkBreakdownDto } from './dto/planning.dto';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('planning')
@UseGuards(JwtAuthGuard, AccessGuard)
export class PlanningController {
  constructor(private planningService: PlanningService) {}

  @Get('pis')
  @RequireAccess('browse')
  getPis(@ProjectKey() projectKey?: string) {
    return this.planningService.getPis(projectKey);
  }

  @Post('pis')
  @RequireAccess('admin')
  createPi(@Body() dto: CreatePiDto, @ProjectKey() projectKey?: string) {
    return this.planningService.createPi(dto, projectKey);
  }

  @Post('sprints')
  @RequireAccess('admin', { from: 'piBody', field: 'piId' })
  createSprint(@Body() dto: CreateSprintDto) {
    return this.planningService.createSprint(dto);
  }

  @Post('work-breakdown')
  @RequireAccess('edit', { from: 'issueBody', field: 'epicId' })
  workBreakdown(@Body() dto: WorkBreakdownDto, @Request() req: { user: { id: string } }) {
    return this.planningService.workBreakdown(dto, req.user.id);
  }
}
