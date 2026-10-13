import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { AddressDto } from '../issue-email/dto';

export class RecipientGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  organizationIds?: string[];

  /** People without an account */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  addresses?: AddressDto[];
}
