import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class SearchDto {
  @IsOptional()
  @IsString()
  jql?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startAt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxResults?: number;
}

export class CreateFilterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  jql!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateFilterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  jql?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}
