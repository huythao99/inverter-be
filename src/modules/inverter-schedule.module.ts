import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterScheduleController } from '../controllers/inverter-schedule.controller';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import {
  InverterSchedule,
  InverterScheduleSchema,
} from '../models/inverter-schedule.schema';
import { InverterSettingModule } from './inverter-setting.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
    ]),
    InverterSettingModule,
  ],
  controllers: [InverterScheduleController],
  providers: [InverterScheduleService],
  exports: [InverterScheduleService],
})
export class InverterScheduleModule {}
