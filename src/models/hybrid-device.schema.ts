import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { StmDeviceBase } from './device-base.schema';

export type HybridDeviceDocument = HybridDevice & Document;

/**
 * A hybrid unit (ESP32 + STM32 hybrid low-frequency inverter, HINVLF v1),
 * HybridControl<N>. Own MQTT namespace (hybrid/{uid}/{deviceId}/...).
 * Discriminator of Device, kind "hybrid", collection "devices".
 */
@Schema({ timestamps: true })
export class HybridDevice extends StmDeviceBase {
  readonly kind?: 'hybrid';
}

export const HybridDeviceSchema = SchemaFactory.createForClass(HybridDevice);
