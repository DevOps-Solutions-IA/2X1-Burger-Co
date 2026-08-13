import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CustomerServiceCaseCategory, CustomerServiceCaseStatus } from '@prisma/client';

export class ListCustomerServiceCasesDto {
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
  @IsEnum(CustomerServiceCaseStatus)
  status?: CustomerServiceCaseStatus;

  @IsOptional()
  @IsEnum(CustomerServiceCaseCategory)
  category?: CustomerServiceCaseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orderTicketId?: string;
}
