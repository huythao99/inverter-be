import { PartialType } from '@nestjs/mapped-types';
import { CreateInverterSettingDto } from './create-inverter-setting.dto';

export class UpdateInverterSettingDto extends PartialType(CreateInverterSettingDto) {} 