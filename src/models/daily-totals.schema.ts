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

  @Prop({ type: Boolean, default: false })
  autoCalculate: boolean;

  // Odometer devices only: FIRST odometer reading seen on this GMT+7 day
  // (kept with $min). Used as the baseline when there is no previous day's
  // reading (first day online), so that day's value is (last - first seen)
  // instead of the whole odometer. Absent on legacy records.
  // NO default on purpose: $min on a null field would keep null forever.
  @Prop({ type: Number })
  odoStartA?: number;

  @Prop({ type: Number })
  odoStartA2?: number;

  // Odometer devices only: LATEST reading of the day (plain $set). Differs
  // from totalA (max) when the STM32 counter restarted from 0 that day.
  // Absent on records written before it existed.
  @Prop({ type: Number })
  lastA?: number;

  @Prop({ type: Number })
  lastA2?: number;

  // Odometer devices only: energy of the day counted frame by frame
  // (OdometerAccumulatorService: sum of the increases between consecutive
  // readings, a counter going back/reset just starts a new baseline). Exact
  // whatever the STM32 counter does. Absent on days before it existed.
  @Prop({ type: Number })
  energyA?: number;

  @Prop({ type: Number })
  energyA2?: number;

  // energyA/energyA2 miss part of the day (Redis was down, or the day the
  // feature was deployed): reads use the odometer formula for that day.
  @Prop({ type: Boolean })
  energyGap?: boolean;

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
