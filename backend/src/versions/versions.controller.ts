import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { VersionsService } from './versions.service';
import { JwtAuthGuard } from '../auth/guards';
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
@UseGuards(JwtAuthGuard)
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get()
  findAll(@ProjectKey() projectKey?: string) {
    return this.versionsService.findAll(projectKey);
  }

  @Post()
  create(@Body() dto: CreateVersionDto, @ProjectKey() projectKey: string | undefined, @Request() req: AuthRequest) {
    return this.versionsService.create(projectKey, dto, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVersionDto, @Request() req: AuthRequest) {
    return this.versionsService.update(id, dto, req.user);
  }
}
