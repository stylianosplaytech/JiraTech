import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { IssueStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StatusDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: IssueStatus })
  @IsEnum(IssueStatus)
  category!: IssueStatus;
}

export class UpdateStatusDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsEnum(IssueStatus)
  category?: IssueStatus;

  @IsOptional()
  @IsBoolean()
  pausesSla?: boolean;
}

export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  statusIds!: string[];
}

export class TransitionPairDto {
  @IsString()
  fromStatusId!: string;

  @IsString()
  toStatusId!: string;
}

export class TransitionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionPairDto)
  transitions!: TransitionPairDto[];
}
