import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class OpenCashSessionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  openingAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  openingBreakdown?: Record<string, number>;
}
