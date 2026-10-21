import { IsString, MaxLength, MinLength } from 'class-validator';

export class OrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}
