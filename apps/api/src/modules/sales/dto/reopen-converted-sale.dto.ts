import { IsString, MinLength } from 'class-validator';

export class ReopenConvertedSaleDto {
  @IsString()
  @MinLength(8)
  reason!: string;
}
