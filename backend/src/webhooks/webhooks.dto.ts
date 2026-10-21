import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WEBHOOK_FORMATS } from './chat-format';
import { WEBHOOK_EVENTS } from './webhook-events';

export class WebhookDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsArray()
  @ArrayMaxSize(WEBHOOK_EVENTS.length + 5)
  @IsString({ each: true })
  events!: string[];

  /** A project key; leave out (or empty) for every project */
  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** JSON: the signed event as is (default). SLACK or TEAMS: a readable message for a chat channel (the address is the channel's incoming webhook). */
  @ApiPropertyOptional({ enum: WEBHOOK_FORMATS })
  @IsOptional()
  @IsIn(WEBHOOK_FORMATS)
  format?: string;

  /** Only issues matching this JQL are sent, e.g. priority = Highest */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  jql?: string;
}
