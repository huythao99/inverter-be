import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterSettingController } from '../controllers/inverter-setting.controller';
import { InverterSettingService } from '../services/inverter-setting.service';
import {
  InverterSetting,
  InverterSettingSchema,
} from '../models/inverter-setting.schema';
import { MqttService } from '../services/mqtt.service';
import { RedisConfig } from '../config/redis.config';
import { GridTieService } from '../services/grid-tie.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterSetting.name, schema: InverterSettingSchema },
    ]),
  ],
  controllers: [InverterSettingController],
  providers: [InverterSettingService, MqttService, RedisConfig, GridTieService],
  exports: [InverterSettingService, GridTieService],
})
export class InverterSettingModule {}
