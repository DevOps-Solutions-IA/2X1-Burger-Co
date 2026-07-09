import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateOperationalAlertDto {
  @IsIn(['ACKNOWLEDGED', 'RESOLVED'])
  status!: 'ACKNOWLEDGED' | 'RESOLVED';

  @IsOptional()
  @IsString()
  notes?: string;
}
