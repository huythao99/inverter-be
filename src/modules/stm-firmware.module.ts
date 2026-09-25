import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { StmFirmware, StmFirmwareSchema } from '../models/stm-firmware.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import { StmFirmwareService } from '../services/stm-firmware.service';
import { StmFirmwareController } from '../controllers/stm-firmware.controller';

@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: StmFirmware.name, schema: StmFirmwareSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
    ]),
  ],
  controllers: [StmFirmwareController],
  providers: [StmFirmwareService],
  exports: [StmFirmwareService],
})
export class StmFirmwareModule {}
