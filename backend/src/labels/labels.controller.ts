import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LabelsService } from './labels.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

class CreateLabelDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

@Controller('labels')
@UseGuards(JwtAuthGuard, AccessGuard)
export class LabelsController {
  constructor(private labelsService: LabelsService) {}

  @Get()
  @RequireAccess('browse')
  findAll(@ProjectKey() projectKey?: string) {
    return this.labelsService.findAll(projectKey);
  }

  @Post()
  @RequireAccess('edit')
  create(@Body() dto: CreateLabelDto, @ProjectKey() projectKey?: string) {
    return this.labelsService.create(dto.name, projectKey);
  }
}
