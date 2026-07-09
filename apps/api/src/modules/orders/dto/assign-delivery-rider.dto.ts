import { IsOptional, IsString } from 'class-validator';

export class AssignDeliveryRiderDto {
  @IsString()
  riderId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
