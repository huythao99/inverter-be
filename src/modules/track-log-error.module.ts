import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrackLogErrorController } from '../controllers/track-log-error.controller';
import { TrackLogErrorService } from '../services/track-log-error.service';
import {
  TrackLogError,
  TrackLogErrorSchema,
} from '../models/track-log-error.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrackLogError.name, schema: TrackLogErrorSchema },
    ]),
  ],
  controllers: [TrackLogErrorController],
  providers: [TrackLogErrorService],
  exports: [TrackLogErrorService],
})
export class TrackLogErrorModule {}
