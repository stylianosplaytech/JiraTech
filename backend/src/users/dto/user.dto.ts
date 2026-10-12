import { IsString, IsEmail, IsEnum, IsOptional, MinLength, IsBoolean } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  /** Leave out to let them choose their own through the welcome email */
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  /** Send a welcome email with a link to choose their password (the default, and required without a password) */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
