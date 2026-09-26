import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { UserApiController } from '../controllers/user-api.controller';
import { FirebaseConfig } from '../config/firebase.config';
import { FirebaseStrategy } from '../auth/strategies/firebase.strategy';
import { InverterDataModule } from './inverter-data.module';
import { DailyTotalsModule } from './daily-totals.module';
import { InverterDeviceModule } from './inverter-device.module';
import { InverterSettingModule } from './inverter-setting.module';
import { InverterScheduleModule } from './inverter-schedule.module';
import { MqttAuthModule } from './mqtt-auth.module';
import { EnergyReportService } from '../services/energy-report.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'firebase' }),
    InverterDataModule,
    DailyTotalsModule,
    InverterDeviceModule,
    InverterSettingModule,
    InverterScheduleModule,
    MqttAuthModule,
  ],
  controllers: [UserApiController],
  providers: [FirebaseConfig, FirebaseStrategy, EnergyReportService],
  exports: [FirebaseConfig],
})
export class UserApiModule {}
