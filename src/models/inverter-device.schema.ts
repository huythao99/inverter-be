import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InverterDeviceDocument = InverterDevice & Document;

@Schema({ timestamps: true })
export class InverterDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  deviceName: string;

  @Prop({ type: String, default: '1.0.0' })
  firmwareVersion: string;

  @Prop({ type: String, default: '' })
  description: string;

  // True once the device has reported the 12-number (pre-calculated daily
  // totals) format at least once. Marks it as an autoCalculate device.
  @Prop({ type: Boolean, default: false })
  autoCalculate: boolean;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterDeviceSchema =
  SchemaFactory.createForClass(InverterDevice);

// Tạo compound unique index cho userId và deviceId
InverterDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
