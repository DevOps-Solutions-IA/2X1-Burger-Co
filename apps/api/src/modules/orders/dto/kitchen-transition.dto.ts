import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

export class KitchenTransitionDto {
  @IsIn(['START_PREPARATION', 'MARK_READY'])
  action!: 'START_PREPARATION' | 'MARK_READY';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}
