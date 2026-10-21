import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ComponentType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateComponentDto {
  @IsString()
  name!: string;

  @ApiProperty({ enum: ComponentType })
  @IsEnum(ComponentType)
  type!: ComponentType;

  @IsOptional()
  @IsString()
  leadId?: string;
}
