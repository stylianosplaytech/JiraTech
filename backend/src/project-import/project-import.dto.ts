import { IsArray, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Sent as the JSON text of the "options" form field next to the uploaded "file". */
export class PreviewImportDto {
  /** UTC offset the CSV's dates are written in, in minutes (e.g. 120 for UTC+2). JSON dates carry their own offset. */
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

  /** Ids of the columns to import, from the preview. Issue key and summary are always imported. */
  @IsArray()
  @IsString({ each: true })
  columns!: string[];

  /** New names for custom field columns (the export only knows some of them by id), by column id */
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  columnNames?: Record<string, string>;

  /** Status name in the file → category (BACKLOG, TO_DO, DOING or CLOSED). Missing names get the suggested one. */
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  statusCategories?: Record<string, string>;
}
