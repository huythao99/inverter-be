import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChargerDeviceController } from '../controllers/charger-device.controller';
import { ChargerDeviceService } from '../services/charger-device.service';
import { ChargerProvisionService } from '../services/charger-provision.service';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';
import {
  ChargerClaim,
  ChargerClaimSchema,
} from '../models/charger-claim.schema';
import { MqttAuthModule } from './mqtt-auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerDevice.name, schema: ChargerDeviceSchema },
      { name: ChargerClaim.name, schema: ChargerClaimSchema },
    ]),
    MqttAuthModule,
  ],
  controllers: [ChargerDeviceController],
  providers: [ChargerDeviceService, ChargerProvisionService],
  exports: [ChargerDeviceService, ChargerProvisionService],
})
export class ChargerDeviceModule {}
