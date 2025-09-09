import { PartialType } from '@nestjs/mapped-types';
import { CreateDailyTotalsDto } from './create-daily-totals.dto';

export class UpdateDailyTotalsDto extends PartialType(CreateDailyTotalsDto) {}
