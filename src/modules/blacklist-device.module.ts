import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlacklistDeviceService } from '../services/blacklist-device.service';
import {
  BlacklistDevice,
  BlacklistDeviceSchema,
} from '../models/blacklist-device.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlacklistDevice.name, schema: BlacklistDeviceSchema },
    ]),
  ],
  providers: [BlacklistDeviceService],
  exports: [BlacklistDeviceService],
})
export class BlacklistDeviceModule {}
