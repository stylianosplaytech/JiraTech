import { IsString, IsDateString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePiDto {
  @IsString()
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

export class CreateSprintDto {
  @IsString()
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  piId!: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}

export class WorkBreakdownItemDto {
  @IsString()
  type!: string;

  @IsString()
  summary!: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsArray()
  componentIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkBreakdownItemDto)
  children?: WorkBreakdownItemDto[];
}

export class WorkBreakdownDto {
  @IsString()
  epicId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkBreakdownItemDto)
  stories!: WorkBreakdownItemDto[];
}
