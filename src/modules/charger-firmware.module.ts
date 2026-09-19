import { Module } from '@nestjs/common';
import { ChargerFirmwareController } from '../controllers/charger-firmware.controller';
import { ChargerFirmwareService } from '../services/charger-firmware.service';
import { ChargerDeviceModule } from './charger-device.module';

@Module({
  imports: [ChargerDeviceModule],
  controllers: [ChargerFirmwareController],
  providers: [ChargerFirmwareService],
  exports: [ChargerFirmwareService],
})
export class ChargerFirmwareModule {}
