import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

class OrderTicketItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateOrderTicketDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderTicketItemDto)
  items!: OrderTicketItemDto[];
}
