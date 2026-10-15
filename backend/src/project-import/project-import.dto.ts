import { IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PreviewImportDto {
  /** The text of a Jira "Export CSV (all fields)" file */
  @IsString()
  @MinLength(1)
  csv!: string;

  /** UTC offset the export's "Created" dates are written in, in minutes (e.g. 120 for UTC+2) */
  @IsOptional()
  @IsInt()
  @Min(-840)
  @Max(840)
  utcOffsetMinutes?: number;
}

export class ImportProjectDto extends PreviewImportDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, {
    message: 'Project key must be 2–10 uppercase letters or digits, starting with a letter',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Status name in the file → category (BACKLOG, TO_DO, DOING or CLOSED). Missing names get the suggested one. */
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  statusCategories?: Record<string, string>;
}
