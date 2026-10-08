import { ProjectAccess, ProjectRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, {
    message: 'Project key must be 2–10 uppercase letters or digits, starting with a letter',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsBoolean()
  strictHierarchy?: boolean;

  @IsOptional()
  @IsEnum(ProjectAccess)
  defaultAccess?: ProjectAccess;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsBoolean()
  strictHierarchy?: boolean;

  @IsOptional()
  @IsEnum(ProjectAccess)
  defaultAccess?: ProjectAccess;
}

export class SetMemberDto {
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
