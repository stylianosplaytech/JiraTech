import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { GadgetType } from '@prisma/client';
import { BREAKDOWN_FIELDS } from '../search/search.service';

export class CreateDashboardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateDashboardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class GadgetConfigDto {
  /** FILTER_RESULTS: how many issues to list. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxRows?: number;

  /** BREAKDOWN: the field to count by. */
  @IsOptional()
  @IsIn(BREAKDOWN_FIELDS)
  groupBy?: (typeof BREAKDOWN_FIELDS)[number];
}

export class CreateGadgetDto {
  @IsIn(Object.values(GadgetType))
  type!: GadgetType;

  @IsString()
  filterId!: string;

  /** Defaults to the filter's name. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GadgetConfigDto)
  config?: GadgetConfigDto;

  @IsOptional()
  @IsBoolean()
  wide?: boolean;
}

export class UpdateGadgetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  filterId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GadgetConfigDto)
  config?: GadgetConfigDto;

  @IsOptional()
  @IsBoolean()
  wide?: boolean;
}

export class ReorderGadgetsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
