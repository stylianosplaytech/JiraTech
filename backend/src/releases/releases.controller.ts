import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';

@Controller('releases')
@UseGuards(JwtAuthGuard, AccessGuard)
export class ReleasesController {
  constructor(private releasesService: ReleasesService) {}

  @Get(':epicId/candidates')
  @RequireAccess('browse', { from: 'issueParam', param: 'epicId' })
  getCandidates(@Param('epicId') epicId: string) {
    return this.releasesService.getCandidates(epicId);
  }

  @Post(':epicId/candidates')
  @RequireAccess('edit', { from: 'issueParam', param: 'epicId' })
  createCandidate(
    @Param('epicId') epicId: string,
    @Body() body: { summary: string; versionIds: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return this.releasesService.createCandidate(epicId, body.summary, body.versionIds, req.user.id);
  }

  @Post('candidates/:id/sign-off')
  @RequireAccess('edit', { from: 'issueParam', param: 'id' })
  signOff(@Param('id') id: string) {
    return this.releasesService.signOffGoldenMaster(id);
  }

  @Get(':epicId/notes')
  @RequireAccess('browse', { from: 'issueParam', param: 'epicId' })
  releaseNotes(@Param('epicId') epicId: string) {
    return this.releasesService.generateReleaseNotes(epicId);
  }
}
