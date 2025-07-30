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

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterDeviceSchema = SchemaFactory.createForClass(InverterDevice);

// Tạo compound unique index cho userId và deviceId
InverterDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true }); 