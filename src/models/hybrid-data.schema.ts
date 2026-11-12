import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes } from 'mongoose';
import type {
  HybridEnergyRef,
  HybridEtot,
} from '../constants/hybrid.constants';

export type HybridDataDocument = HybridData & Document;

export interface HybridNak {
  /** SET / CMD (what was refused). */
  of: string;
  err: string;
  key?: string;
  raw: string;
  at: Date;
}

/** Outcome of the last $SETADV (advanced settings, §13). */
export interface HybridAdvResult {
  ok: boolean;
  /** NAK reason: PW, PWLOCK, RUNNING, RANGE, NOSIGNAL, LOCAL, BUSY, ... */
  err?: string;
  key?: string;
  at: Date;
}

/**
 * Latest state of a hybrid (HINVLF v1): the last $TLM / $CFG / $INFO as
 * KEY -> VALUE maps (strings, exactly as the STM32 sent them), the last
 * $NAK and the status heartbeat.
 */
@Schema({ timestamps: true, collection: 'hybriddatas' })
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

  // Advanced settings (§13): last $ADV, when the last $SETADV was asked and
  // how it ended. advUnsupportedFw: STM32 FW that answered $GET,ADV with
  // UNSUP (another FW, e.g. after an update, is asked again).
  @Prop({ type: SchemaTypes.Mixed })
  adv?: Record<string, string>;

  @Prop()
  advAt?: Date;

  @Prop()
  advUnsupportedFw?: string;

  @Prop()
  advRequestAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  advResult?: HybridAdvResult;

  // Counters of the last $TLM used for energy (survives a backend restart).
  @Prop({ type: SchemaTypes.Mixed, select: false })
  energyRef?: HybridEnergyRef & { at: Date };

  // Last $ETOT (lifetime totals in the STM32 flash, Wh) and when it came.
  @Prop({ type: SchemaTypes.Mixed })
  etot?: HybridEtot;

  @Prop()
  etotAt?: Date;

  // Largest totals seen (energy is counted from here; survives a restart).
  @Prop({ type: SchemaTypes.Mixed, select: false })
  etotMax?: HybridEtot;

  @Prop()
  status?: string;

  @Prop()
  lastSeenAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const HybridDataSchema = SchemaFactory.createForClass(HybridData);

HybridDataSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
