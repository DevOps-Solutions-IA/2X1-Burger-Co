import { IsOptional, IsString } from 'class-validator';

export class ClaimOrderTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
