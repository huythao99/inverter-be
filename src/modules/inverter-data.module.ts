import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterDataService } from '../services/inverter-data.service';
import {
  InverterData,
  InverterDataSchema,
} from '../models/inverter-data.schema';
import { DailyTotalsModule } from './daily-totals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterData.name, schema: InverterDataSchema },
    ]),
    DailyTotalsModule,
  ],
  providers: [InverterDataService],
  exports: [InverterDataService],
})
export class InverterDataModule {}
