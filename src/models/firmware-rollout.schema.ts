import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FirmwareRolloutDocument = FirmwareRollout & Document;
export type RolloutStatus = 'running' | 'paused' | 'completed' | 'aborted';

export interface RolloutEvent {
  at: Date;
  type: string;
  message: string;
  by?: string | null;
}

/**
 * Staged (canary) rollout of an inverter ESP32 build: offered to a growing
 * share of the devices (e.g. 5% -> 25% -> 50% -> 100%), watched through the
 * devices' reports, paused automatically when too many of them fail.
 */
@Schema({ collection: 'firmware_rollouts', timestamps: true })
export class FirmwareRollout {
  _id: Types.ObjectId;

  @Prop({ required: true, default: 'inverter' })
  product: string;

  @Prop({ required: true })
  firmwareId: string;

  @Prop({ required: true })
  version: string;

  @Prop({ required: true })
  url: string;

  /** Stable version when the rollout started. */
  @Prop({ required: true })
  fromVersion: string;

  @Prop({ type: [Number], required: true })
  stages: number[];

  @Prop({ required: true, default: 0 })
  stageIndex: number;

  @Prop({ required: true })
  percent: number;

  @Prop({ required: true, enum: ['running', 'paused', 'completed', 'aborted'] })
  status: RolloutStatus;

  /** Send the update command to the devices of each new stage. */
  @Prop({ default: true })
  autoPush: boolean;

  /** Go to the next stage by itself when the current one is healthy. */
  @Prop({ default: false })
  autoAdvance: boolean;

  /** Minimum hours in a stage before auto-advance. */
  @Prop({ default: 24 })
  stageHours: number;

  /** Pause when failures / (healthy + failures) goes above this (0..1). */
  @Prop({ default: 0.2 })
  maxFailRate: number;

  /** Results needed before the fail rate is trusted. */
  @Prop({ default: 5 })
  minSamples: number;

  /** Minutes a device must keep sending data after the update to be "healthy". */
  @Prop({ default: 30 })
  observeMinutes: number;

  @Prop({ type: Date, default: Date.now })
  stageStartedAt: Date;

  /** A push that could not be sent yet (another bulk job was running). */
  @Prop({ default: false })
  pendingPush: boolean;

  @Prop({ type: String, default: null })
  pauseReason: string | null;

  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({
    type: [{ at: Date, type: String, message: String, by: String, _id: false }],
    default: [],
  })
  events: RolloutEvent[];

  createdAt: Date;
  updatedAt: Date;
}

export const FirmwareRolloutSchema =
  SchemaFactory.createForClass(FirmwareRollout);
FirmwareRolloutSchema.index({ status: 1, createdAt: -1 });

export type RolloutDeviceDocument = RolloutDevice & Document;
export type RolloutDeviceState =
  | 'pushed' // update command sent, no answer yet
  | 'installing' // device reported starting / downloading / installing
  | 'updated' // reported the new version, being observed
  | 'healthy' // kept sending data for observeMinutes
  | 'failed' // OTA reported failed
  | 'rolled_back' // came back on the old version after a successful OTA
  | 'unhealthy' // no data / crashed after the update
  | 'stalled'; // started but never finished (probably went offline)

export const ROLLOUT_FAILURE_STATES: RolloutDeviceState[] = [
  'failed',
  'rolled_back',
  'unhealthy',
];

@Schema({ collection: 'firmware_rollout_devices', timestamps: true })
export class RolloutDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  rolloutId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  state: RolloutDeviceState;

  @Prop({ type: String, default: null })
  fromVersion: string | null;

  @Prop({ type: String, default: null })
  otaStatus: string | null;

  @Prop({ type: Date, default: null })
  otaSuccessAt: Date | null;

  /** When the device first reported the new version. */
  @Prop({ type: Date, default: null })
  updatedAt2: Date | null;

  @Prop({ type: String, default: null })
  reason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const RolloutDeviceSchema = SchemaFactory.createForClass(RolloutDevice);
RolloutDeviceSchema.index(
  { rolloutId: 1, userId: 1, deviceId: 1 },
  { unique: true },
);
RolloutDeviceSchema.index({ rolloutId: 1, state: 1 });
