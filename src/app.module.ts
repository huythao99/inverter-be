import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InverterDataModule } from './modules/inverter-data.module';
import { InverterSettingModule } from './modules/inverter-setting.module';
import { InverterDeviceModule } from './modules/inverter-device.module';
import { InverterScheduleModule } from './modules/inverter-schedule.module';
import { DailyTotalsModule } from './modules/daily-totals.module';

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
    EventEmitterModule.forRoot(),
    InverterSettingModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        user: configService.get<string>('MONGODB_USERNAME'),
        pass: configService.get<string>('MONGODB_PASSWORD'),
        dbName: configService.get<string>('MONGODB_DATABASE'),
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }),
      inject: [ConfigService],
    }),
    InverterDataModule,
    InverterDeviceModule,
    InverterScheduleModule,
    DailyTotalsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
