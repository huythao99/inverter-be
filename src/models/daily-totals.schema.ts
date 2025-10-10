import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DailyTotalsDocument = DailyTotals & Document;

@Schema({ timestamps: true })
export class DailyTotals {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true, type: Date })
  date: Date;

  @Prop({ required: true, type: Number, default: 0 })
  totalA: number;

  @Prop({ required: true, type: Number, default: 0 })
  totalA2: number;

  @Prop({ type: String, default: 'Asia/Ho_Chi_Minh' })
  timezone: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export const DailyTotalsSchema = SchemaFactory.createForClass(DailyTotals);

// Create compound index for unique constraint and faster queries
DailyTotalsSchema.index({ userId: 1, deviceId: 1, date: 1 }, { unique: true });

// Additional indexes for better query performance
DailyTotalsSchema.index({ userId: 1, date: -1 });
DailyTotalsSchema.index({ deviceId: 1, date: -1 });
DailyTotalsSchema.index({ date: -1 });
DailyTotalsSchema.index({ createdAt: -1 });
DailyTotalsSchema.index({ deletedAt: 1 });
