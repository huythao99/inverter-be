import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CmsChargerController } from '../controllers/cms-charger.controller';
import { CmsChargerService } from '../services/cms-charger.service';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';
import { ChargerData, ChargerDataSchema } from '../models/charger-data.schema';
import {
  ChargerSetting,
  ChargerSettingSchema,
} from '../models/charger-setting.schema';
import { ChargerFirmwareModule } from './charger-firmware.module';
import { MqttAuthModule } from './mqtt-auth.module';

// Admin dashboard endpoints for chargers. Auth uses the AdminGuard
// ('admin-jwt' passport strategy registered globally by CmsModule).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerDevice.name, schema: ChargerDeviceSchema },
      { name: ChargerData.name, schema: ChargerDataSchema },
      { name: ChargerSetting.name, schema: ChargerSettingSchema },
    ]),
    ChargerFirmwareModule,
    MqttAuthModule,
  ],
  controllers: [CmsChargerController],
  providers: [CmsChargerService],
})
export class CmsChargerModule {}
