import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlacklistDeviceService } from '../services/blacklist-device.service';
import {
  BlacklistDevice,
  BlacklistDeviceSchema,
} from '../models/blacklist-device.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlacklistDevice.name, schema: BlacklistDeviceSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: ChargerDevice.name, schema: ChargerDeviceSchema },
    ]),
  ],
  providers: [BlacklistDeviceService],
  exports: [BlacklistDeviceService],
})
export class BlacklistDeviceModule {}
