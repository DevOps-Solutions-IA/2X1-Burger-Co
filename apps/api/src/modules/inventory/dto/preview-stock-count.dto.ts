import { IsIn, IsOptional, IsString } from 'class-validator';

export class PreviewStockCountDto {
  @IsOptional()
  @IsIn(['CRITICAL', 'ALL', 'PRODUCTS', 'INGREDIENTS'])
  scope?: 'CRITICAL' | 'ALL' | 'PRODUCTS' | 'INGREDIENTS';

  @IsOptional()
  @IsString()
  search?: string;
}
