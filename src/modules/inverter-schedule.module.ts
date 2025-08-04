import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InverterScheduleController } from '../controllers/inverter-schedule.controller';
import { InverterScheduleService } from '../services/inverter-schedule.service';
import {
  InverterSchedule,
  InverterScheduleSchema,
} from '../models/inverter-schedule.schema';
import { MqttService } from '../services/mqtt.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InverterSchedule.name, schema: InverterScheduleSchema },
    ]),
  ],
  controllers: [InverterScheduleController],
  providers: [InverterScheduleService, MqttService],
  exports: [InverterScheduleService],
})
export class InverterScheduleModule {}