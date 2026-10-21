import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class InboundWebhookDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  projectKey!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  issueType?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  priorityFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  dedupe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolvePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolveEquals?: string;

  @IsOptional()
  @IsBoolean()
  includePayload?: boolean;
}

export class TestPayloadDto {
  @IsObject()
  payload!: Record<string, unknown>;
}
