import {
  IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { MailTransport } from '@prisma/client';

/** Outgoing email settings. Fields left out keep their value; '' clears the optional ones. */
export class MailSettingsDto {
  /** SMTP server, or a Gmail account through Google's API */
  @IsOptional()
  @IsEnum(MailTransport)
  transport?: MailTransport;

  /** Google Cloud OAuth client ID; changing it disconnects the Gmail account */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^([A-Za-z0-9._-]+\.apps\.googleusercontent\.com)?$/, { message: 'The Client ID looks like 1234-abc.apps.googleusercontent.com' })
  gmailClientId?: string;

  /** Write-only; '' removes it */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  gmailClientSecret?: string;

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

export class GoogleStartDto {
  /** The address the admin uses JiraTech at; Google sends them back there */
  @Matches(/^https?:\/\/[^\s/]+$/, { message: 'origin must look like https://jiratech.example.com' })
  @MaxLength(300)
  origin!: string;
}
