import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyTotalsController } from '../controllers/daily-totals.controller';
import { RedisTotalsController } from '../controllers/redis-totals.controller';
import { DailyTotalsService } from '../services/daily-totals.service';
import { RedisDailyTotalsService } from '../services/redis-daily-totals.service';
import { RedisConfig } from '../config/redis.config';
import { DailyTotals, DailyTotalsSchema } from '../models/daily-totals.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyTotals.name, schema: DailyTotalsSchema },
    ]),
  ],
  controllers: [DailyTotalsController, RedisTotalsController],
  providers: [DailyTotalsService, RedisDailyTotalsService, RedisConfig],
  exports: [DailyTotalsService, RedisDailyTotalsService],
})
export class DailyTotalsModule {}
