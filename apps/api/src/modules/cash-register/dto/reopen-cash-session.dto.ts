import { IsOptional, IsString } from 'class-validator';

export class ReopenCashSessionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsString()
  reason!: string;
}
