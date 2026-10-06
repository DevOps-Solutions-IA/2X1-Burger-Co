import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { COMMAND_STATUSES, COMMAND_TYPES } from '../secure-command.types';

export class ListSecureCommandsDto {
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
  @IsIn(COMMAND_STATUSES)
  status?: (typeof COMMAND_STATUSES)[number];

  @IsOptional()
  @IsIn(COMMAND_TYPES)
  commandType?: (typeof COMMAND_TYPES)[number];
}

export class ApproveSecureCommandDto {
  @IsString()
  @MaxLength(200)
  reasonCode!: string;

  @IsString()
  @MaxLength(200)
  policyReference!: string;
}

export class RejectSecureCommandDto {
  @IsString()
  @MaxLength(200)
  reasonCode!: string;
}
