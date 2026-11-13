import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Device, DeviceSchema } from '../models/device.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';
import {
  HybridDevice,
  HybridDeviceSchema,
} from '../models/hybrid-device.schema';
import { DevicesService } from '../services/devices.service';

/**
 * The device models, registered ONCE (a Mongoose discriminator can only be
 * added to its base model one time): Device (collection "devices") and its
 * kinds InverterDevice / ChargerDevice / HybridDevice. Global: every module
 * injects @InjectModel(InverterDevice.name) etc. without listing them.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Device.name,
        schema: DeviceSchema,
        discriminators: [
          {
            name: InverterDevice.name,
            schema: InverterDeviceSchema,
            value: 'inverter',
          },
          {
            name: ChargerDevice.name,
            schema: ChargerDeviceSchema,
            value: 'charger',
          },
          {
            name: HybridDevice.name,
            schema: HybridDeviceSchema,
            value: 'hybrid',
          },
        ],
      },
    ]),
  ],
  providers: [DevicesService],
  exports: [MongooseModule, DevicesService],
})
export class DevicesModule {}
