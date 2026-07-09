import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const movementTypes = [
  'PURCHASE',
  'SALE',
  'ADJUSTMENT',
  'RECIPE_CONSUMPTION',
  'WASTE',
  'DAMAGE',
] as const;

const itemTypes = ['PRODUCT', 'INGREDIENT'] as const;

export class FindInventoryMovementsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(itemTypes)
  itemType?: (typeof itemTypes)[number];

  @IsOptional()
  @IsIn(movementTypes)
  type?: (typeof movementTypes)[number];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
