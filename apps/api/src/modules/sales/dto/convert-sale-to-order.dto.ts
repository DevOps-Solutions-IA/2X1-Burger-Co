import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class ConvertSaleToOrderDto {
  @IsIn(['COUNTER', 'DINE_IN', 'DELIVERY'])
  type!: 'COUNTER' | 'DINE_IN' | 'DELIVERY';

  @IsOptional()
  @IsString()
  tableId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  deliveryReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  @MinLength(8)
  reason!: string;
}
