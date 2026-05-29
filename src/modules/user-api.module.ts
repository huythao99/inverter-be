import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { UserApiController } from '../controllers/user-api.controller';
import { FirebaseConfig } from '../config/firebase.config';
import { FirebaseStrategy } from '../auth/strategies/firebase.strategy';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  InverterData,
  InverterDataSchema,
} from '../models/inverter-data.schema';
import {
  InverterSetting,
  InverterSettingSchema,
} from '../models/inverter-setting.schema';
import {
  InverterSchedule,
  InverterScheduleSchema,
} from '../models/inverter-schedule.schema';
import { DailyTotals, DailyTotalsSchema } from '../models/daily-totals.schema';
import { InverterDeviceService } from '../services/inverter-device.service';
import { InverterDataService } from '../services/inverter-data.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { DailyTotalsService } from '../services/daily-totals.service';
import { MqttService } from '../services/mqtt.service';
import { RedisDailyTotalsService } from '../services/redis-daily-totals.service';
import { RedisConfig } from '../config/redis.config';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'firebase' }),
    MongooseModule.forFeature([
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: InverterData.name, schema: InverterDataSchema },
      { name: InverterSetting.name, schema: InverterSettingSchema },
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
      { name: DailyTotals.name, schema: DailyTotalsSchema },
    ]),
  ],
  controllers: [UserApiController],
  providers: [
    FirebaseConfig,
    FirebaseStrategy,
    InverterDeviceService,
    InverterDataService,
    InverterSettingService,
    InverterScheduleService,
    DailyTotalsService,
    MqttService,
    RedisDailyTotalsService,
    RedisConfig,
  ],
  exports: [FirebaseConfig],
})
export class UserApiModule {}
