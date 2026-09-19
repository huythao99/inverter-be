import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChargerSettingController } from '../controllers/charger-setting.controller';
import { ChargerSettingService } from '../services/charger-setting.service';
import {
  ChargerSetting,
  ChargerSettingSchema,
} from '../models/charger-setting.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerSetting.name, schema: ChargerSettingSchema },
    ]),
  ],
  controllers: [ChargerSettingController],
  providers: [ChargerSettingService],
  exports: [ChargerSettingService],
})
export class ChargerSettingModule {}
