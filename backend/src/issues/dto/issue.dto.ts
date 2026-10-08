import {
  IsString, IsOptional, IsEnum, IsArray, IsNumber, IsBoolean, MinLength, MaxLength, IsObject,
} from 'class-validator';
import { IssueType, Priority } from '@prisma/client';

export class CreateIssueDto {
  @IsEnum(IssueType)
  type!: IssueType;

  @IsString()
  @MinLength(3)
  summary!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  epicName?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  reporterId?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsOptional()
  @IsString()
  piId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  componentIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fixVersionIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affectsVersionIds?: string[];

  @IsOptional()
  @IsNumber()
  estimate?: number;

  @IsOptional()
  @IsNumber()
  remainingEstimate?: number;

  @IsOptional()
  @IsString()
  parentLinkKey?: string;

  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}

export class UpdateIssueDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  summary?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  reporterId?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  componentIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fixVersionIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affectsVersionIds?: string[];

  @IsOptional()
  @IsNumber()
  estimate?: number;

  @IsOptional()
  @IsNumber()
  remainingEstimate?: number;

  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  @IsOptional()
  @IsString()
  epicName?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}

export class TransitionDto {
  /** Target workflow status */
  @IsOptional()
  @IsString()
  statusId?: string;

  /** Legacy: a status category code (BACKLOG, TO_DO, DOING, CLOSED) or a status name */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}

export class CreateLinkDto {
  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsString()
  targetKey?: string;

  @IsString()
  type!: string;
}

export class AddWatcherDto {
  @IsOptional()
  @IsString()
  userId?: string;
}

export class CreateWorkLogDto {
  @IsNumber()
  timeSpentMinutes!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateCustomFieldsDto {
  @IsObject()
  customFields!: Record<string, string>;
}


export class CommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32000)
  body!: string;
}
