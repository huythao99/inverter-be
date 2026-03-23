import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CmsController } from '../controllers/cms.controller';
import { CmsService } from '../services/cms.service';
import { Admin, AdminSchema } from '../models/admin.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  MqttCredential,
  MqttCredentialSchema,
} from '../models/mqtt-credential.schema';
import { DailyTotals, DailyTotalsSchema } from '../models/daily-totals.schema';
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
import { AdminJwtStrategy } from '../auth/strategies/admin-jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>('CMS_JWT_EXPIRES_IN', '24h');
        // Convert to seconds for JWT
        const expiresInSeconds = expiresIn.endsWith('h')
          ? parseInt(expiresIn) * 3600
          : expiresIn.endsWith('d')
            ? parseInt(expiresIn) * 86400
            : parseInt(expiresIn) || 86400;
        return {
          secret: configService.get<string>(
            'CMS_JWT_SECRET',
            'cms_default_secret_change_in_production',
          ),
          signOptions: {
            expiresIn: expiresInSeconds,
          },
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: MqttCredential.name, schema: MqttCredentialSchema },
      { name: DailyTotals.name, schema: DailyTotalsSchema },
      { name: InverterData.name, schema: InverterDataSchema },
      { name: InverterSetting.name, schema: InverterSettingSchema },
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
    ]),
  ],
  controllers: [CmsController],
  providers: [CmsService, AdminJwtStrategy],
  exports: [CmsService],
})
export class CmsModule {}
