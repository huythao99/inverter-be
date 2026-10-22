import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes } from 'mongoose';
import type { HybridEnergyRef } from '../constants/hybrid.constants';

export type HybridDataDocument = HybridData & Document;

export interface HybridNak {
  /** SET / CMD (what was refused). */
  of: string;
  err: string;
  key?: string;
  raw: string;
  at: Date;
}

/**
 * Latest state of a hybrid (HINVLF v1): the last $TLM / $CFG / $INFO as
 * KEY -> VALUE maps (strings, exactly as the STM32 sent them), the last
 * $NAK and the status heartbeat.
 */
@Schema({ timestamps: true })
export class HybridData {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ type: SchemaTypes.Mixed })
  tlm?: Record<string, string>;

  @Prop()
  tlmAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  cfg?: Record<string, string>;

  @Prop()
  cfgAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  info?: Record<string, string>;

  @Prop()
  infoAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  lastNak?: HybridNak;

  // Counters of the last $TLM used for energy (survives a backend restart).
  @Prop({ type: SchemaTypes.Mixed, select: false })
  energyRef?: HybridEnergyRef & { at: Date };

  @Prop()
  status?: string;

  @Prop()
  lastSeenAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const HybridDataSchema = SchemaFactory.createForClass(HybridData);

HybridDataSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
