import { Module } from '@nestjs/common';
import { InverterDeviceController } from '../controllers/inverter-device.controller';
import { InverterDeviceService } from '../services/inverter-device.service';

// InverterDevice model: global DevicesModule (collection "devices", kind "inverter").
@Module({
  controllers: [InverterDeviceController],
  providers: [InverterDeviceService],
  exports: [InverterDeviceService],
})
export class InverterDeviceModule {}
