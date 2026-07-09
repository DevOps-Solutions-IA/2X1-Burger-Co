import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseCashSessionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  closingBreakdown?: Record<string, number>;
}
