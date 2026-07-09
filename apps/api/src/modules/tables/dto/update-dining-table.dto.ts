import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateDiningTableDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  capacity?: number;

  @IsOptional()
  @IsIn(['FREE', 'RESERVED', 'OUT_OF_SERVICE'])
  status?: 'FREE' | 'RESERVED' | 'OUT_OF_SERVICE';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
