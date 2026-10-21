import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class SetPasswordDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters' })
  @MaxLength(200)
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Enter your email address' })
  @MaxLength(254)
  email!: string;
}
