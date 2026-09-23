import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisConfig } from '../config/redis.config';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import { DeviceRestartService } from '../services/device-restart.service';

// Global so the user API (app + web) and the CMS controllers can both inject
// DeviceRestartService without re-importing this module.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterDevice.name, schema: InverterDeviceSchema },
    ]),
  ],
  providers: [DeviceRestartService, RedisConfig],
  exports: [DeviceRestartService],
})
export class DeviceRestartModule {}
