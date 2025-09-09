import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDailyTotalsDto {
  @IsString()
  userId: string;

  @IsString()
  deviceId: string;

  @IsDateString()
  date: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  totalA: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  totalA2: number;

  @IsOptional()
  @IsString()
  timezone?: string = 'Asia/Ho_Chi_Minh';
}
