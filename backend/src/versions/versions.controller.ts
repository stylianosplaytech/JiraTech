import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { VersionsService } from './versions.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';
import { AuthRequest } from '../common/auth-user';

class CreateVersionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  releaseDate?: string;
}

class UpdateVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  releaseDate?: string;

  @IsOptional()
  @IsBoolean()
  released?: boolean;
}

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
