import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** A project key; leave out (or empty) for every project */
  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsString()
  event!: string;

  /** { fields?: string[] } or { toStatus?: string }, checked by the service */
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  jql?: string;

  /** Checked action by action by the service */
  @IsArray()
  actions!: unknown[];
}

export class TestDto {
  /** Scheduled rules may leave it out to see which issues they would act on */
  @IsOptional()
  @IsString()
  issueKey?: string;
}
