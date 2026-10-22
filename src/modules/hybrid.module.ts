import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import {
  HybridDevice,
  HybridDeviceSchema,
} from '../models/hybrid-device.schema';
import {
  HybridSetting,
  HybridSettingSchema,
} from '../models/hybrid-setting.schema';
import { HybridData, HybridDataSchema } from '../models/hybrid-data.schema';
import {
  HybridEnergy,
  HybridEnergySchema,
} from '../models/hybrid-energy.schema';
import {
  ChargerClaim,
  ChargerClaimSchema,
} from '../models/charger-claim.schema';
import { HybridDeviceService } from '../services/hybrid-device.service';
import { HybridSettingService } from '../services/hybrid-setting.service';
import { HybridDataService } from '../services/hybrid-data.service';
import { HybridFirmwareService } from '../services/hybrid-firmware.service';
import { HybridDeviceController } from '../controllers/hybrid-device.controller';
import { UserHybridController } from '../controllers/user-hybrid.controller';
import { MqttAuthModule } from './mqtt-auth.module';

// Hybrid devices: firmware API (/api/hybrid-*) + end-user API
// (/api/user/hybrids). MQTT namespace hybrid/{uid}/{deviceId}/...
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'firebase' }),
    MongooseModule.forFeature([
      { name: HybridDevice.name, schema: HybridDeviceSchema },
      { name: HybridSetting.name, schema: HybridSettingSchema },
      { name: HybridData.name, schema: HybridDataSchema },
      { name: HybridEnergy.name, schema: HybridEnergySchema },
      { name: ChargerClaim.name, schema: ChargerClaimSchema },
    ]),
    MqttAuthModule,
  ],
  controllers: [HybridDeviceController, UserHybridController],
  providers: [
    HybridDeviceService,
    HybridSettingService,
    HybridDataService,
    HybridFirmwareService,
  ],
  exports: [HybridDeviceService, HybridSettingService, HybridDataService],
})
export class HybridModule {}
