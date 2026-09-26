import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InverterDataModule } from './modules/inverter-data.module';
import { InverterSettingModule } from './modules/inverter-setting.module';
import { InverterDeviceModule } from './modules/inverter-device.module';
import { InverterScheduleModule } from './modules/inverter-schedule.module';
import { DailyTotalsModule } from './modules/daily-totals.module';
import { MqttAuthModule } from './modules/mqtt-auth.module';
import { CmsModule } from './modules/cms.module';
import { UserApiModule } from './modules/user-api.module';
import { TrackLogErrorModule } from './modules/track-log-error.module';
import { MqttModule } from './modules/mqtt.module';
import { DeviceRestartModule } from './modules/device-restart.module';
import { BlacklistDeviceModule } from './modules/blacklist-device.module';
import { BetaFirmwareDeviceModule } from './modules/beta-firmware-device.module';
import { StmFirmwareModule } from './modules/stm-firmware.module';
import { SpacesModule } from './modules/spaces.module';
import { EspFirmwareModule } from './modules/esp-firmware.module';
import { FirmwareController } from './controllers/firmware.controller';
import { FirmwareService } from './services/firmware.service';
import { ChargerDeviceModule } from './modules/charger-device.module';
import { ChargerSettingModule } from './modules/charger-setting.module';
import { ChargerDataModule } from './modules/charger-data.module';
import { ChargerFirmwareModule } from './modules/charger-firmware.module';
import { CmsChargerModule } from './modules/cms-charger.module';
import { UserChargerModule } from './modules/user-charger.module';
import { AuditLogModule } from './modules/audit-log.module';
import { DeviceHealthModule } from './modules/device-health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 0,
      max: 1000,
    }),
    // Rate limiting: 10 requests per 60 seconds for general API
    // Login endpoints have stricter limits (5 per minute)
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'short',
          ttl: 1000, // 1 second
          limit: 3, // 3 requests per second
        },
        {
          name: 'medium',
          ttl: 10000, // 10 seconds
          limit: 20, // 20 requests per 10 seconds
        },
        {
          name: 'long',
          ttl: 60000, // 1 minute
          limit: 100, // 100 requests per minute
        },
      ],
    }),
    EventEmitterModule.forRoot(),
    AuditLogModule,
    DeviceHealthModule,
    BlacklistDeviceModule,
    BetaFirmwareDeviceModule,
    SpacesModule,
    EspFirmwareModule,
    StmFirmwareModule,
    MqttModule,
    DeviceRestartModule,
    InverterSettingModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        user: configService.get<string>('MONGODB_USERNAME'),
        pass: configService.get<string>('MONGODB_PASSWORD'),
        dbName: configService.get<string>('MONGODB_DATABASE'),
        maxPoolSize: 20,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        connectTimeoutMS: 10000,
        retryWrites: false,
        maxConnecting: 5,
      }),
      inject: [ConfigService],
    }),
    InverterDataModule,
    InverterDeviceModule,
    InverterScheduleModule,
    DailyTotalsModule,
    MqttAuthModule,
    CmsModule,
    UserApiModule,
    TrackLogErrorModule,
    ChargerDeviceModule,
    ChargerSettingModule,
    ChargerDataModule,
    ChargerFirmwareModule,
    CmsChargerModule,
    UserChargerModule,
  ],
  controllers: [AppController, FirmwareController],
  providers: [AppService, FirmwareService],
})
export class AppModule {}
