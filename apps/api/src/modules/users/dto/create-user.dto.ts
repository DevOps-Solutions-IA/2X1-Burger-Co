import { ArrayNotEmpty, IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(3)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleIds!: string[];

  @IsOptional()
  @IsString()
  @MinLength(2)
  accessName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  accessCode?: string;
}
