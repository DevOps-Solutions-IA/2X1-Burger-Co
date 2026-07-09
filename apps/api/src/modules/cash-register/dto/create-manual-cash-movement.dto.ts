import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateManualCashMovementDto {
  @IsIn(['OTHER_INCOME', 'OTHER_EXPENSE'])
  type!: 'OTHER_INCOME' | 'OTHER_EXPENSE';

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  classification!: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
