import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { StmDeviceBase } from './device-base.schema';

export type HybridDeviceDocument = HybridDevice & Document;

/**
 * A hybrid unit (ESP32 + STM32 hybrid low-frequency inverter, HINVLF v1),
 * HybridControl<N>. Separate device type with its own collections and MQTT
 * namespace (hybrid/{uid}/{deviceId}/...). Fields: device-base.schema.ts.
 */
@Schema({ timestamps: true, collection: 'hybriddevices' })
export class HybridDevice extends StmDeviceBase {}

export const HybridDeviceSchema = SchemaFactory.createForClass(HybridDevice);

HybridDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
HybridDeviceSchema.index({ deviceId: 1 });
