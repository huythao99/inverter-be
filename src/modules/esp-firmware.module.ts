import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EspFirmware, EspFirmwareSchema } from '../models/esp-firmware.schema';
import { EspFirmwareService } from '../services/esp-firmware.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: EspFirmware.name, schema: EspFirmwareSchema },
    ]),
  ],
  providers: [EspFirmwareService],
  exports: [EspFirmwareService],
})
export class EspFirmwareModule {}
