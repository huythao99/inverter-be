import { PartialType } from '@nestjs/mapped-types';
import { CreateInverterScheduleDto } from './create-inverter-schedule.dto';

export class UpdateInverterScheduleDto extends PartialType(CreateInverterScheduleDto) {}