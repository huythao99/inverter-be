import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HybridEnergyDocument = HybridEnergy & Document;

/** Daily energy of a hybrid (Wh, Vietnam calendar day), from $TLM counters. */
@Schema({ timestamps: true })
export class HybridEnergy {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  /** "YYYY-MM-DD" (UTC+7). */
  @Prop({ required: true })
  day: string;

  /** Battery discharge. */
  @Prop({ default: 0 })
  edis: number;

  /** Battery charge. */
  @Prop({ default: 0 })
  echg: number;

  /** Taken from the grid. */
  @Prop({ default: 0 })
  eimp: number;

  /** Pushed to the grid. */
  @Prop({ default: 0 })
  eexp: number;
}

export const HybridEnergySchema = SchemaFactory.createForClass(HybridEnergy);

HybridEnergySchema.index({ userId: 1, deviceId: 1, day: 1 }, { unique: true });
