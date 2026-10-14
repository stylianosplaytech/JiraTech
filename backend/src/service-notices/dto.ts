import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { AddressDto, RecipientRefDto } from '../issue-email/dto';

export class NoticeTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsString()
  @MaxLength(255)
  subject!: string;

  /** NoticeContent, checked by normalizeContent */
  @IsObject()
  content!: Record<string, unknown>;
}

export class PreviewNoticeDto {
  @IsObject()
  content!: Record<string, unknown>;
}

export class SendNoticeDto {
  /** The template it was written from, if any */
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsString()
  @MinLength(1, { message: 'Give the notice a subject' })
  @MaxLength(255)
  subject!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  to?: AddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  cc?: AddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  bcc?: AddressDto[];

  /** Recipient groups and organizations picked as a whole: everyone in them, as they are when it is sent */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  toGroups?: RecipientRefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  ccGroups?: RecipientRefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  bccGroups?: RecipientRefDto[];

  /** Files uploaded with POST /service-notices/files to send with it */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  attachmentIds?: string[];

  /** Only to the sender, to see it in a real mail client; not recorded */
  @IsOptional()
  @IsBoolean()
  test?: boolean;
}
