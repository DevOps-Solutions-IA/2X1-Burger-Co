import { IsString, MinLength } from 'class-validator';

export class ReopenOrderTicketDto {
  @IsString()
  @MinLength(8)
  reason!: string;
}
