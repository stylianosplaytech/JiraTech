import {
  IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';

/** Outgoing email settings. Fields left out keep their value; '' clears the optional ones. */
export class MailSettingsDto {
  /** '' goes back to the SMTP_* environment variables (or the mail-outbox folder) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9.-]*$/, { message: 'Enter the mail server host name, e.g. smtp.example.com' })
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  smtpUser?: string;

  /** Write-only; '' removes it */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  smtpPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^"<>\r\n]*$/, { message: 'The sender name can\'t contain quotes, < or >' })
  fromName?: string;

  @IsOptional()
  @ValidateIf((o: MailSettingsDto) => !!o.fromAddress)
  @IsEmail({}, { message: 'Enter a valid sender address' })
  @MaxLength(254)
  fromAddress?: string;

  /** e.g. https://jiratech.example.com; '' goes back to APP_URL */
  @IsOptional()
  @ValidateIf((o: MailSettingsDto) => !!o.appUrl)
  @Matches(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/, { message: 'Enter the full address, e.g. https://jiratech.example.com' })
  @MaxLength(500)
  appUrl?: string;
}

export class TestMailDto {
  @IsEmail({}, { message: 'Enter the address to send the test to' })
  to!: string;
}
