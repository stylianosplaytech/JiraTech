import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ComponentType } from '@prisma/client';

export class CreateComponentDto {
  @IsString()
  name!: string;

  @IsEnum(ComponentType)
  type!: ComponentType;

  @IsOptional()
  @IsString()
  leadId?: string;
}
