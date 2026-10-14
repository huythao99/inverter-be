import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TrackLogErrorDocument = TrackLogError & Document;

@Schema({ timestamps: true })
export class TrackLogError {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  errorCode: string;

  @Prop({ required: true })
  errorMessage: string;

  createdAt: Date;
  updatedAt: Date;
}

export const TrackLogErrorSchema = SchemaFactory.createForClass(TrackLogError);

/** Device logs are only useful for a while; Mongo's TTL monitor removes older ones. */
export const TRACK_LOG_TTL_SECONDS = 7 * 24 * 3600;

// {userId, deviceId} also serves userId-only queries (index prefix), so a separate
// {userId: 1} index is not needed. The TTL index on createdAt also serves sorting
// by createdAt in either direction.
TrackLogErrorSchema.index({ userId: 1, deviceId: 1 });
TrackLogErrorSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: TRACK_LOG_TTL_SECONDS },
);
TrackLogErrorSchema.index({ deviceId: 1 });
