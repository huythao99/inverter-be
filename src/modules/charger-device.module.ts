import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChargerDeviceController } from '../controllers/charger-device.controller';
import { ChargerDeviceService } from '../services/charger-device.service';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerDevice.name, schema: ChargerDeviceSchema },
    ]),
  ],
  controllers: [ChargerDeviceController],
  providers: [ChargerDeviceService],
  exports: [ChargerDeviceService],
})
export class ChargerDeviceModule {}
