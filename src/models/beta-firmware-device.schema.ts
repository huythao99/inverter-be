import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BetaFirmwareDeviceDocument = BetaFirmwareDevice & Document;

// Devices allowed to download the beta firmware build. An entry may target a
// specific userId+deviceId pair, or (when userId is empty) the deviceId for
// every user.
@Schema({ timestamps: true })
export class BetaFirmwareDevice {
  _id: Types.ObjectId;

  @Prop({ required: true })
  deviceId: string;

  @Prop()
  userId: string;

  @Prop()
  note: string;

  createdAt: Date;
  updatedAt: Date;
}

export const BetaFirmwareDeviceSchema =
  SchemaFactory.createForClass(BetaFirmwareDevice);

BetaFirmwareDeviceSchema.index({ deviceId: 1 });
BetaFirmwareDeviceSchema.index({ userId: 1, deviceId: 1 });
