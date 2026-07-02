import { IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class SetGridTieDto {
  // 1 = tắt hoà lưới (grid-tie OFF), 0 = grid-tie ON
  @Type(() => Number)
  @IsIn([0, 1])
  status: number;
}
