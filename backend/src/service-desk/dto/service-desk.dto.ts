import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { IssueType, Priority } from '@prisma/client';

class RequestTypeFieldDto {
  @IsString()
  fieldId!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class RequestTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(IssueType)
  issueType!: IssueType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestTypeFieldDto)
  fields?: RequestTypeFieldDto[];
}

export class UpdateRequestTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestTypeFieldDto)
  fields?: RequestTypeFieldDto[];
}

/** A year at most; null clears the goal. */
const MAX_GOAL = 525_600;

export class SlaTargetDto {
  @IsEnum(Priority)
  priority!: Priority;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GOAL)
  firstResponseMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GOAL)
  resolutionMinutes?: number | null;
}

export class SlaTargetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlaTargetDto)
  targets!: SlaTargetDto[];
}

export class QueueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  jql!: string;
}

export class UpdateQueueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  jql?: string;
}

/** Logos are kept in the database (hosts like Render wipe local disks), so they stay small. */
const MAX_LOGO_CHARS = 350_000; // ≈ 256 KB image as a base64 data URL

export class CreatePortalDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** URL name: /portal/:slug (checked in the service) */
  @IsString()
  slug!: string;
}

export class UpdatePortalDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  /** Any customer may use it (otherwise only the listed organizations and customers). */
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  /** Request types offered; [] offers all of the project's. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requestTypeIds?: string[];

  /** Shown on the help center's landing page; '' clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  welcome?: string;

  /** Accent colour, e.g. #0052CC; '' restores the default. */
  @IsOptional()
  @IsString()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'Colour must look like #0052CC' })
  color?: string;

  /** A PNG, JPEG, GIF, WebP or SVG image as a data URL; '' removes the logo. Rendered only through <img>. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LOGO_CHARS, { message: 'The logo is too large: use an image under 256 KB' })
  @Matches(/^(data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)?$/, { message: 'The logo must be a PNG, JPEG, GIF, WebP or SVG image' })
  logo?: string;
}

/** Which organization a request is shared with; null keeps it private. */
export class RequestOrganizationDto {
  @IsOptional()
  @IsString()
  organizationId?: string | null;
}

export class PortalRequestDto {
  @IsString()
  requestTypeId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32000)
  description?: string;

  /** Values of the request type's fields, by custom field key. */
  @IsOptional()
  @IsObject()
  fields?: Record<string, string>;

  /** Share with this organization (one of the requester's that the desk serves). */
  @IsOptional()
  @IsString()
  organizationId?: string;

  /** false keeps the request private; otherwise it is shared with the requester's organization, if any. */
  @IsOptional()
  @IsBoolean()
  shareWithOrganization?: boolean;

  /** Agents only: raise the request for this customer. */
  @IsOptional()
  @IsString()
  onBehalfOfId?: string;
}

export class PortalCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32000)
  body!: string;
}
