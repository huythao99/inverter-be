import { Prop } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * Fields every device entry has (inverterdevices / chargerdevices /
 * hybriddevices). One entry per (owner userId, deviceId); the collections
 * stay separate because each device type has its own data / settings.
 * @nestjs/mongoose copies a parent class's @Prop()s into the child schema.
 */
export abstract class DeviceBase {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  // SSID AP of the device: GTIControl1230, ChargerControl1369, HybridControl0015
  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  deviceName: string;

  // ESP32 firmware the device reports.
  @Prop({ type: String, default: '1.0.0' })
  firmwareVersion: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

/** Last STM32 FOTA state (trigger + stm/ota/status reports). */
export interface StmOtaState {
  status: string;
  progress?: number;
  message?: string;
  targetVersion?: string;
  source?: string;
  at: Date;
}

/**
 * Devices with an STM32 power board flashed through the ESP32 (inverter,
 * hybrid). Version is "major.voltage.patch" (2nd number = voltage class),
 * reported by the STM32 itself ($INFO FW / stm/info / PATCH
 * /api/stm-firmware/info). Null until first report.
 */
export abstract class StmDeviceBase extends DeviceBase {
  @Prop({ type: String, default: null })
  stmFwVersion: string | null;

  @Prop({ type: String, default: null })
  stmFwCrc: string | null; // "0xXXXXXXXX"

  @Prop({ type: Date, default: null })
  stmInfoAt: Date | null;

  @Prop({ type: Object, default: null })
  stmOta: StmOtaState | null;
}
