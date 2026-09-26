import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeviceHealth,
  DeviceHealthSchema,
} from '../models/device-health.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import { DeviceHealthService } from '../services/device-health.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceHealth.name, schema: DeviceHealthSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
    ]),
  ],
  providers: [DeviceHealthService],
  exports: [DeviceHealthService],
})
export class DeviceHealthModule {}
