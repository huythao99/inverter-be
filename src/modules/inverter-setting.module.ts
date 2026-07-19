import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterSettingController } from '../controllers/inverter-setting.controller';
import { ShareController } from '../controllers/share.controller';
import { InverterSettingService } from '../services/inverter-setting.service';
import {
  InverterSetting,
  InverterSettingSchema,
} from '../models/inverter-setting.schema';
import { RedisConfig } from '../config/redis.config';
import { GridTieService } from '../services/grid-tie.service';
import { ShareService } from '../services/share.service';
import { ShareGroup, ShareGroupSchema } from '../models/share-group.schema';
import { InverterDataModule } from './inverter-data.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterSetting.name, schema: InverterSettingSchema },
      { name: ShareGroup.name, schema: ShareGroupSchema },
    ]),
    InverterDataModule,
  ],
  controllers: [InverterSettingController, ShareController],
  providers: [
    InverterSettingService,
    RedisConfig,
    GridTieService,
    ShareService,
  ],
  exports: [InverterSettingService, GridTieService, ShareService],
})
export class InverterSettingModule {}
