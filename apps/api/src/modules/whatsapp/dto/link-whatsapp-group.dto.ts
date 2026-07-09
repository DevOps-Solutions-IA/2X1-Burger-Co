import { IsString } from 'class-validator';

export class LinkWhatsappGroupDto {
  @IsString()
  inviteLink!: string;
}
