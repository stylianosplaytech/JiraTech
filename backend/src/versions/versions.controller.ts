import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { VersionsService } from './versions.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';
import { AuthRequest } from '../common/auth-user';
import { CreateVersionDto, UpdateVersionDto } from './versions.dto';

@Controller('versions')
@UseGuards(JwtAuthGuard, AccessGuard)
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get()
  @RequireAccess('browse')
  findAll(@ProjectKey() projectKey?: string) {
    return this.versionsService.findAll(projectKey);
  }

  @Post()
  @RequireAccess('admin')
  create(@Body() dto: CreateVersionDto, @ProjectKey() projectKey: string | undefined, @Request() req: AuthRequest) {
    return this.versionsService.create(projectKey, dto, req.user);
  }

  @Patch(':id')
  @RequireAccess('admin', { from: 'versionParam', param: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateVersionDto, @Request() req: AuthRequest) {
    return this.versionsService.update(id, dto, req.user);
  }
}
