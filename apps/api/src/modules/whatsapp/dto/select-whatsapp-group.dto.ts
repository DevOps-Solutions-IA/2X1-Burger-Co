import { IsOptional, IsString } from 'class-validator';

export class SelectWhatsappGroupDto {
  @IsString()
  groupJid!: string;

  @IsOptional()
  @IsString()
  groupLabel?: string;
}
