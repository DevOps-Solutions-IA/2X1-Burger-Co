import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateWaiterAssignmentDto {
  @IsString()
  waiterId!: string;

  @IsIn(['GROUP', 'TABLE'])
  scope!: 'GROUP' | 'TABLE';

  @IsOptional()
  @IsString()
  tableGroupId?: string;

  @IsOptional()
  @IsString()
  tableId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
