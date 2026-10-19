import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ChargerData } from './charger-data.schema';

export type HybridDataDocument = HybridData & Document;

/**
 * Latest known state of a hybrid (merged tlm / cfg / info frames + status
 * heartbeat). Same fields as ChargerData (same STM32 frames), own collection.
 * `out` / `cfgOut` show the grid-tie state the machine actually runs:
 * INV = feeding the inverter / grid, BAT = charging the battery only.
 */
@Schema({ timestamps: true })
export class HybridData extends ChargerData {}

export const HybridDataSchema = SchemaFactory.createForClass(HybridData);

HybridDataSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
