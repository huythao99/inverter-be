import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChargerScheduleController } from '../controllers/charger-schedule.controller';
import { ChargerScheduleService } from '../services/charger-schedule.service';
import {
  ChargerSchedule,
  ChargerScheduleSchema,
} from '../models/charger-schedule.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerSchedule.name, schema: ChargerScheduleSchema },
    ]),
  ],
  controllers: [ChargerScheduleController],
  providers: [ChargerScheduleService],
  exports: [ChargerScheduleService],
})
export class ChargerScheduleModule {}
