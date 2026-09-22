import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BetaFirmwareDeviceService } from '../services/beta-firmware-device.service';
import {
  BetaFirmwareDevice,
  BetaFirmwareDeviceSchema,
} from '../models/beta-firmware-device.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BetaFirmwareDevice.name, schema: BetaFirmwareDeviceSchema },
    ]),
  ],
  providers: [BetaFirmwareDeviceService],
  exports: [BetaFirmwareDeviceService],
})
export class BetaFirmwareDeviceModule {}
