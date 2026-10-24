import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, SchemaTypes } from 'mongoose';
import type { HybridConfig } from '../constants/hybrid.constants';

export type HybridSettingDocument = HybridSetting & Document;

export interface HybridSetRequest {
  /** Keys sent (after pull-along), e.g. { PEXP: 2000 }. */
  config: HybridConfig;
  /** Same as the $SET item list. */
  set: string;
  at: Date;
}

/**
 * Desired inverter config of a hybrid (HINVLF v1 writable keys: MODE PCHG
 * PEXP PIMP VEXP VCUT VRES PMAX PCMAX). Only keys the user has set are
 * stored; the firmware $SETs the ones that differ from the machine's $CFG
 * and re-applies them after an STM32 reboot (SET is RAM-only there).
 */
@Schema({ timestamps: true })
export class HybridSetting {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  config: HybridConfig;

  // Last change the user saved (protocol v1.1: the ESP32 $SETs it once, then
  // $CMD,SAVE; the machine's $CFG is the truth afterwards).
  @Prop({ type: SchemaTypes.Mixed })
  request?: HybridSetRequest;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const HybridSettingSchema = SchemaFactory.createForClass(HybridSetting);

HybridSettingSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
