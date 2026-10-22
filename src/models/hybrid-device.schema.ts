import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type HybridDeviceDocument = HybridDevice & Document;

/**
 * A hybrid unit (ESP32 + STM32 hybrid low-frequency inverter, HINVLF v1).
 * Separate device type with its own collections and MQTT namespace
 * (hybrid/{uid}/{deviceId}/...).
 */
@Schema({ timestamps: true })
export class HybridDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  // SSID AP of the device, e.g. "HybridControl1001"
  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  deviceName: string;

  @Prop({ type: String, default: '1.0.0' })
  firmwareVersion: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const HybridDeviceSchema = SchemaFactory.createForClass(HybridDevice);

HybridDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
HybridDeviceSchema.index({ deviceId: 1 });
