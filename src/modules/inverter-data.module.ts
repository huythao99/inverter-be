import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterDataController } from '../controllers/inverter-data.controller';
import { InverterDataService } from '../services/inverter-data.service';
import { InverterData, InverterDataSchema } from '../models/inverter-data.schema';
import { SettingDataGateway } from '../gateways/setting-data.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterData.name, schema: InverterDataSchema },
    ]),
  ],
  controllers: [InverterDataController],
  providers: [InverterDataService, SettingDataGateway],
  exports: [InverterDataService],
})
export class InverterDataModule {} 