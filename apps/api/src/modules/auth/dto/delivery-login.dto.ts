import { IsString, Matches, MinLength } from 'class-validator';

export class DeliveryLoginDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^[A-Z]\d{5,}$/i, {
    message: 'El código de acceso debe iniciar con una letra y continuar con números.',
  })
  accessCode!: string;
}
