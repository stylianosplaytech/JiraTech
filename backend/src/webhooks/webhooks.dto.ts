import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
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
}
