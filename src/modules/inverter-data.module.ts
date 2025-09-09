import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterDataController } from '../controllers/inverter-data.controller';
import { InverterDataService } from '../services/inverter-data.service';
import {
  InverterData,
  InverterDataSchema,
} from '../models/inverter-data.schema';
import { MqttService } from '../services/mqtt.service';
import { DailyTotalsModule } from './daily-totals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterData.name, schema: InverterDataSchema },
    ]),
    DailyTotalsModule,
  ],
  controllers: [InverterDataController],
  providers: [InverterDataService, MqttService],
  exports: [InverterDataService],
})
export class InverterDataModule {}
