import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterSettingController } from '../controllers/inverter-setting.controller';
import { InverterSettingService } from '../services/inverter-setting.service';
import { InverterSetting, InverterSettingSchema } from '../models/inverter-setting.schema';
import { SettingDataGateway } from '../gateways/setting-data.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterSetting.name, schema: InverterSettingSchema },
    ]),
  ],
  controllers: [InverterSettingController],
  providers: [InverterSettingService, SettingDataGateway],
  exports: [InverterSettingService],
})
export class InverterSettingModule {} 