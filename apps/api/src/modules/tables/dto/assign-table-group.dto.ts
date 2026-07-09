import { IsOptional, IsString } from 'class-validator';

export class AssignTableGroupDto {
  @IsOptional()
  @IsString()
  groupId?: string | null;
}
