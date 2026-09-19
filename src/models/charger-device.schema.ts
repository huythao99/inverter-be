import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChargerDeviceDocument = ChargerDevice & Document;

@Schema({ timestamps: true })
export class ChargerDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  // SSID AP of the device, e.g. "ChargerControl1369"
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

export const ChargerDeviceSchema = SchemaFactory.createForClass(ChargerDevice);

ChargerDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
