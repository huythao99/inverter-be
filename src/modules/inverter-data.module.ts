import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterDataController } from '../controllers/inverter-data.controller';
import { InverterDataService } from '../services/inverter-data.service';
import {
  InverterData,
  InverterDataSchema,
} from '../models/inverter-data.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import { DailyTotalsModule } from './daily-totals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterData.name, schema: InverterDataSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
    ]),
    DailyTotalsModule,
  ],
  controllers: [InverterDataController],
  providers: [InverterDataService],
  exports: [InverterDataService],
})
export class InverterDataModule {}
