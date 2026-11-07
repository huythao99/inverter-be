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

  // ---- STM32 (power board): version from $INFO FW / after an update ----
  // "major.voltage.patch" (2nd number = voltage class). Null until reported.
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

  // Inverter id this unit was converted from by OTA (CMS "Chuyển sang
  // hybrid"), e.g. "GTIControl1312". Null for a hybrid flashed as one.
  @Prop({ type: String, default: null })
  convertedFrom: string | null;

  // CMS "Chuyển về inverter": while set, /api/hybrid-firmware serves this
  // inverter build; the unit then runs as gtiDeviceId. Removed with the
  // hybrid entry once the unit shows up as that inverter.
  @Prop({ type: Object, default: null })
  inverterConversion: {
    gtiDeviceId: string;
    version: string;
    url: string;
    requestedAt: Date;
    by?: string | null;
  } | null;
}

export const HybridDeviceSchema = SchemaFactory.createForClass(HybridDevice);

HybridDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
HybridDeviceSchema.index({ deviceId: 1 });
