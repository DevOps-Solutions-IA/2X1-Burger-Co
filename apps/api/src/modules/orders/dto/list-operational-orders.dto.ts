import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';

export class ListOperationalOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @IsOptional()
  @IsEnum(OrderTicketStatus)
  status?: OrderTicketStatus;

  @IsOptional()
  @IsEnum(OrderTicketType)
  type?: OrderTicketType;

  @IsOptional()
  @IsEnum(DeliveryWorkflowStatus)
  deliveryWorkflowStatus?: DeliveryWorkflowStatus;

  @IsOptional()
  @IsIn(['true', 'false'])
  activeOnly?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
