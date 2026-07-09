import { ProductBrand, ProductKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  categoryId!: string;

  @IsString()
  unitId!: string;

  @IsEnum(ProductKind)
  kind!: ProductKind;

  @IsOptional()
  @IsEnum(ProductBrand)
  brand?: ProductBrand;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsNumber()
  @Min(0)
  salePrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  currentStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMin?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
