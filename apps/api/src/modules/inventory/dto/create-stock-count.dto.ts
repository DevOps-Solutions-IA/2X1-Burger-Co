import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class CreateStockCountItemDto {
  @IsIn(['PRODUCT', 'INGREDIENT'])
  itemType!: 'PRODUCT' | 'INGREDIENT';

  @IsString()
  itemId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  countedStock!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateStockCountDto {
  @IsIn(['CRITICAL', 'ALL', 'PRODUCTS', 'INGREDIENTS'])
  scope!: 'CRITICAL' | 'ALL' | 'PRODUCTS' | 'INGREDIENTS';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockCountItemDto)
  items!: CreateStockCountItemDto[];
}
