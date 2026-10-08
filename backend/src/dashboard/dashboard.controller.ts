import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { RagStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, AccessGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get()
  @RequireAccess('browse')
  getDashboard(@Query('piId') piId?: string, @ProjectKey() projectKey?: string) {
    return this.dashboardService.getDashboard(piId, projectKey);
  }

  @Patch('issues/:id/rag')
  @RequireAccess('edit', { from: 'issueParam', param: 'id' })
  updateRag(@Param('id') id: string, @Body() body: { ragStatus: RagStatus }) {
    return this.dashboardService.updateRag(id, body.ragStatus);
  }
}
