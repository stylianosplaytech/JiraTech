import { IsObject } from 'class-validator';

export class SchemeDto {
  /** {event: [recipient, ...]}, checked by NotificationSchemeService */
  @IsObject()
  scheme!: Record<string, unknown>;
}
