import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
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

export class PortalSettingsDto {
  @IsBoolean()
  portalOpen!: boolean;
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
