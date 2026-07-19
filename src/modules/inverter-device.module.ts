import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterDeviceController } from '../controllers/inverter-device.controller';
import { InverterDeviceService } from '../services/inverter-device.service';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterDevice.name, schema: InverterDeviceSchema },
    ]),
  ],
  controllers: [InverterDeviceController],
  providers: [InverterDeviceService],
  exports: [InverterDeviceService],
})
export class InverterDeviceModule {}
