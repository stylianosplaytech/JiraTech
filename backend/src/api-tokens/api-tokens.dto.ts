import { ApiTokenAccess } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiTokenDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: ApiTokenAccess })
  @IsEnum(ApiTokenAccess)
  access!: ApiTokenAccess;

  /** Days until it stops working; leave out for a token that doesn't expire */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
