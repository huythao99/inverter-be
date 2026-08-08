import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BlacklistDeviceDocument = BlacklistDevice & Document;

@Schema({ timestamps: true })
export class BlacklistDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  deviceId: string;

  @Prop()
  userId: string;

  @Prop()
  reason: string;

  createdAt: Date;
  updatedAt: Date;
}

export const BlacklistDeviceSchema =
  SchemaFactory.createForClass(BlacklistDevice);

BlacklistDeviceSchema.index({ deviceId: 1 });
BlacklistDeviceSchema.index({ userId: 1, deviceId: 1 });
