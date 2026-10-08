import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LabelsService } from './labels.service';
import { JwtAuthGuard } from '../auth/guards';
import { ProjectKey } from '../common/project-key.decorator';

class CreateLabelDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

@Controller('labels')
@UseGuards(JwtAuthGuard)
export class LabelsController {
  constructor(private labelsService: LabelsService) {}

  @Get()
  findAll(@ProjectKey() projectKey?: string) {
    return this.labelsService.findAll(projectKey);
  }

  @Post()
  create(@Body() dto: CreateLabelDto, @ProjectKey() projectKey?: string) {
    return this.labelsService.create(dto.name, projectKey);
  }
}
