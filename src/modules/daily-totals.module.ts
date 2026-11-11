import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyTotalsService } from '../services/daily-totals.service';
import { RedisDailyTotalsService } from '../services/redis-daily-totals.service';
import { RedisConfig } from '../config/redis.config';
import { OdometerAccumulatorService } from '../services/odometer-accumulator.service';
import { DailyTotals, DailyTotalsSchema } from '../models/daily-totals.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyTotals.name, schema: DailyTotalsSchema },
    ]),
  ],
  providers: [
    DailyTotalsService,
    RedisDailyTotalsService,
    RedisConfig,
    OdometerAccumulatorService,
  ],
  exports: [
    DailyTotalsService,
    RedisDailyTotalsService,
    OdometerAccumulatorService,
  ],
})
export class DailyTotalsModule {}
