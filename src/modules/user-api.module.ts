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
  InverterSetting,
  InverterSettingSchema,
} from '../models/inverter-setting.schema';
import {
  InverterSchedule,
  InverterScheduleSchema,
} from '../models/inverter-schedule.schema';
import { InverterDeviceService } from '../services/inverter-device.service';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import { InverterDataModule } from './inverter-data.module';
import { DailyTotalsModule } from './daily-totals.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'firebase' }),
    MongooseModule.forFeature([
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: InverterSetting.name, schema: InverterSettingSchema },
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
    ]),
    InverterDataModule,
    DailyTotalsModule,
  ],
  controllers: [UserApiController],
  providers: [
    FirebaseConfig,
    FirebaseStrategy,
    InverterDeviceService,
    InverterSettingService,
    InverterScheduleService,
  ],
  exports: [FirebaseConfig],
})
export class UserApiModule {}
