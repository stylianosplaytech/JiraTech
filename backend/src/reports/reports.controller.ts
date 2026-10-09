import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get()
  @RequireAccess('browse')
  getReport(@Query('from') from?: string, @Query('to') to?: string, @ProjectKey() projectKey?: string) {
    return this.reportsService.getReport(projectKey, from, to);
  }
}
