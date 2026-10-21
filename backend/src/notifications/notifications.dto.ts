import { IsBoolean, IsOptional } from 'class-validator';

export class PreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}
