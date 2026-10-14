import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt } from 'class-validator';
import { CustomFieldType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomFieldDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @ApiProperty({ enum: CustomFieldType })
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
