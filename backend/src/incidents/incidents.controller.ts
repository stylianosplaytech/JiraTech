import { Controller, Post, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { EscalationAction } from '@prisma/client';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('incidents')
@UseGuards(JwtAuthGuard)
export class IncidentsController {
  constructor(private incidentsService: IncidentsService) {}

  @Post(':id/escalate')
  escalate(
    @Param('id') id: string,
    @Body() body: { action: EscalationAction; toTeam?: string; note?: string },
    @Request() req: { user: { id: string } },
  ) {
    return this.incidentsService.escalate(id, req.user.id, body.action, body.toTeam, body.note);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.incidentsService.getEscalationHistory(id);
  }
}
