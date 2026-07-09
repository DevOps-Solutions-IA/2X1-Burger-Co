import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateWaiterAssignmentDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
