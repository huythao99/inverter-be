import { PartialType } from '@nestjs/mapped-types';
import { CreateChargerDeviceDto } from './create-charger-device.dto';

export class UpdateChargerDeviceDto extends PartialType(
  CreateChargerDeviceDto,
) {}
