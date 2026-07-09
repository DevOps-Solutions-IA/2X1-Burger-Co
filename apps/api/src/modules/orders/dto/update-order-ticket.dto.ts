import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateOrderTicketDto {
  @IsOptional()
  @IsIn(['OPEN', 'IN_PREPARATION', 'SERVED', 'PAYMENT_PENDING', 'CANCELLED'])
  status?: 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING' | 'CANCELLED';

  @IsOptional()
  @IsIn(['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'COUNTER'])
  type?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';

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
  @Type(() => Number)
  @IsNumber()
  deliveryLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryLongitude?: number;

  @IsOptional()
  @IsString()
  deliveryLocationProvider?: string;

  @IsOptional()
  @IsString()
  deliveryLocationPlaceId?: string;

  @IsOptional()
  @IsString()
  deliveryLocationFormattedAddress?: string;

  @IsOptional()
  @IsString()
  deliveryLocationConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';

  @IsOptional()
  @IsString()
  deliveryFeeEditReason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
