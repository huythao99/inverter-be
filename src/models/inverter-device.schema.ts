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

  // ---- STM32 (power board) firmware, as reported by the STM32 itself ------
  // Reported via PATCH /api/stm-firmware/info/:userId/:deviceId or the MQTT
  // topic inverter/{uid}/{deviceId}/stm/info. Null until first report.
  // Version is "major.voltage.patch" (2nd number = voltage class).
  @Prop({ type: String, default: null })
  stmFwVersion: string | null;

  @Prop({ type: String, default: null })
  stmFwCrc: string | null; // "0xXXXXXXXX"

  @Prop({ type: Date, default: null })
  stmInfoAt: Date | null;

  // Last STM32 FOTA state (trigger + stm/ota/status reports).
  @Prop({ type: Object, default: null })
  stmOta: {
    status: string;
    progress?: number;
    message?: string;
    targetVersion?: string;
    source?: string;
    at: Date;
  } | null;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterDeviceSchema =
  SchemaFactory.createForClass(InverterDevice);

// Tạo compound unique index cho userId và deviceId
InverterDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
