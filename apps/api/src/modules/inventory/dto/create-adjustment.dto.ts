import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateAdjustmentDto {
  @ValidateIf((value) => !value.ingredientId)
  @IsString()
  productId?: string;

  @ValidateIf((value) => !value.productId)
  @IsString()
  ingredientId?: string;

  @Type(() => Number)
  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['ADJUSTMENT', 'WASTE', 'DAMAGE', 'INTERNAL_USE'])
  movementType?: 'ADJUSTMENT' | 'WASTE' | 'DAMAGE' | 'INTERNAL_USE';
}
