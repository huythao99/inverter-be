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

TrackLogErrorSchema.index({ userId: 1, deviceId: 1 });
TrackLogErrorSchema.index({ createdAt: -1 });
TrackLogErrorSchema.index({ userId: 1 });
TrackLogErrorSchema.index({ deviceId: 1 });
