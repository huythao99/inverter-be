import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HomeAssistantService } from '../services/home-assistant.service';
import { HomeAssistantConfig } from '../config/home-assistant.config';
import { MqttService } from '../services/mqtt.service';
import { MqttAuthModule } from './mqtt-auth.module';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  InverterData,
  InverterDataSchema,
} from '../models/inverter-data.schema';
import { DailyTotals, DailyTotalsSchema } from '../models/daily-totals.schema';
import {
  InverterSetting,
  InverterSettingSchema,
} from '../models/inverter-setting.schema';
import {
  InverterSchedule,
  InverterScheduleSchema,
} from '../models/inverter-schedule.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: InverterData.name, schema: InverterDataSchema },
      { name: DailyTotals.name, schema: DailyTotalsSchema },
      { name: InverterSetting.name, schema: InverterSettingSchema },
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
    ]),
    forwardRef(() => MqttAuthModule),
  ],
  providers: [HomeAssistantService, HomeAssistantConfig, MqttService],
  exports: [HomeAssistantService, HomeAssistantConfig],
})
export class HomeAssistantModule {}
