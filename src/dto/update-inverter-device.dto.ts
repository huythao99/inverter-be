import { PartialType } from '@nestjs/mapped-types';
import { CreateInverterDeviceDto } from './create-inverter-device.dto';

export class UpdateInverterDeviceDto extends PartialType(
  CreateInverterDeviceDto,
) {}
