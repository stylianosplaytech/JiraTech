import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt } from 'class-validator';
import { CustomFieldType, UserRole } from '@prisma/client';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../auth/guards';
import { AccessGuard, RequireAccess } from '../access/access.guard';
import { ProjectKey } from '../common/project-key.decorator';

class CreateCustomFieldDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}

@Controller('custom-fields')
@UseGuards(JwtAuthGuard, AccessGuard)
export class CustomFieldsController {
  constructor(private customFieldsService: CustomFieldsService) {}

  @Get()
  @RequireAccess('browse')
  getDefinitions(@ProjectKey() projectKey?: string) {
    return this.customFieldsService.getDefinitions(projectKey);
  }

  @Post()
  @RequireAccess('admin')
  createDefinition(
    @Body() dto: CreateCustomFieldDto,
    @Request() req: { user: { role: UserRole } },
    @ProjectKey() projectKey?: string,
  ) {
    return this.customFieldsService.createDefinition(dto, req.user.role, projectKey);
  }
}
