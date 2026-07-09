import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ResolveDeliveryLocationInboxDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsBoolean()
  ignore?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
