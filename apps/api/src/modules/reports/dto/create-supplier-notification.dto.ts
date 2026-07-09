import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateSupplierNotificationDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ingredientIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
