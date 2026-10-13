import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested,
} from 'class-validator';

export class AddressDto {
  @IsEmail({}, { message: 'Each recipient needs a valid email address' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Reached through this recipient group or organization (replying to all of an earlier email keeps it) */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  via?: string;
}

/** A recipient group or organization picked as a whole in an email's To, Cc or Bcc. */
export class RecipientRefDto {
  @IsIn(['group', 'organization'])
  type!: 'group' | 'organization';

  @IsString()
  id!: string;
}

export const EMAIL_MODES = ['reply', 'replyAll', 'forward', 'new'] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export class SendEmailDto {
  @IsIn(EMAIL_MODES)
  mode!: EmailMode;

  /** The email being replied to or forwarded */
  @IsOptional()
  @IsString()
  replyToId?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  to!: AddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  cc?: AddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  bcc?: AddressDto[];

  /** Recipient groups and organizations picked as a whole: everyone in them, as they are when it is sent */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  toGroups?: RecipientRefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  ccGroups?: RecipientRefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  bccGroups?: RecipientRefDto[];

  @IsString()
  @MaxLength(255)
  subject!: string;

  /** Editor HTML */
  @IsString()
  @MaxLength(200000)
  html!: string;

  /** Put the replied-to or forwarded email below the new text */
  @IsOptional()
  @IsBoolean()
  includeQuote?: boolean;

  /** Files already on the request to send with it */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  attachmentIds?: string[];

  /** Keep it off the customer's portal (an internal note), e.g. forwarding to a supplier */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class RenderTemplateDto {
  @IsString()
  templateId!: string;

  /** Who it's for: the {{customer.*}} placeholders describe them (otherwise the request's customer) */
  @IsOptional()
  @IsEmail()
  to?: string;
}

export class EmailTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @IsString()
  @MaxLength(100000)
  body!: string;

  /** A service desk's own template; otherwise global (admins only). Not changeable after creation. */
  @IsOptional()
  @IsString()
  projectKey?: string;
}
