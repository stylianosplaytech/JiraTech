import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LabelsService } from './labels.service';
import { JwtAuthGuard } from '../auth/guards';

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
  findAll() {
    return this.labelsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateLabelDto) {
    return this.labelsService.create(dto.name);
  }
}
