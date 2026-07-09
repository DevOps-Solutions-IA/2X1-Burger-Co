import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class SyncWaiterOrderItemDto {
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

export class SyncWaiterOrderDto {
  @IsString()
  tableId!: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['OPEN', 'IN_PREPARATION', 'SERVED', 'PAYMENT_PENDING'])
  status?: 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncWaiterOrderItemDto)
  items!: SyncWaiterOrderItemDto[];

  @IsString()
  clientMutationId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  takeOwnership?: boolean;
}
