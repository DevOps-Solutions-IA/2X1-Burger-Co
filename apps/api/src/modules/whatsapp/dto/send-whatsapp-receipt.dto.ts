import { IsString, Matches } from 'class-validator';

export class SendWhatsappReceiptDto {
  @IsString()
  @Matches(/^[0-9+\s()-]{8,20}$/, {
    message: 'Ingresa un número de celular válido.',
  })
  phone!: string;
}
