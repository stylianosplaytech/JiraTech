import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt } from 'class-validator';
import { CustomFieldType, UserRole } from '@prisma/client';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../auth/guards';

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
@UseGuards(JwtAuthGuard)
export class CustomFieldsController {
  constructor(private customFieldsService: CustomFieldsService) {}

  @Get()
  getDefinitions() {
    return this.customFieldsService.getDefinitions();
  }

  @Post()
  createDefinition(
    @Body() dto: CreateCustomFieldDto,
    @Request() req: { user: { role: UserRole } },
  ) {
    return this.customFieldsService.createDefinition(dto, req.user.role);
  }
}
