/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InverterDataModule } from './modules/inverter-data.module';
import { InverterSettingModule } from './modules/inverter-setting.module';
import { InverterDeviceModule } from './modules/inverter-device.module';
import { InverterScheduleModule } from './modules/inverter-schedule.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    InverterSettingModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    InverterDataModule,
    InverterDeviceModule,
    InverterScheduleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
