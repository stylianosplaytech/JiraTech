import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { JwtAuthGuard } from '../auth/guards';

@Controller('releases')
@UseGuards(JwtAuthGuard)
export class ReleasesController {
  constructor(private releasesService: ReleasesService) {}

  @Get(':epicId/candidates')
  getCandidates(@Param('epicId') epicId: string) {
    return this.releasesService.getCandidates(epicId);
  }

  @Post(':epicId/candidates')
  createCandidate(
    @Param('epicId') epicId: string,
    @Body() body: { summary: string; versionIds: string[] },
    @Request() req: { user: { id: string } },
  ) {
    return this.releasesService.createCandidate(epicId, body.summary, body.versionIds, req.user.id);
  }

  @Post('candidates/:id/sign-off')
  signOff(@Param('id') id: string) {
    return this.releasesService.signOffGoldenMaster(id);
  }

  @Get(':epicId/notes')
  releaseNotes(@Param('epicId') epicId: string) {
    return this.releasesService.generateReleaseNotes(epicId);
  }
}
