import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class CheckoutOrderPaymentDto {
  @IsString()
  paymentMethodId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  changeAmount?: number;
}

export class CheckoutOrderTicketDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  baseSubtotal?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutOrderPaymentDto)
  payments!: CheckoutOrderPaymentDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
