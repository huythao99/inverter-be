import { PartialType } from '@nestjs/mapped-types';
import { CreateInverterDataDto } from './create-inverter-data.dto';

export class UpdateInverterDataDto extends PartialType(CreateInverterDataDto) {}
