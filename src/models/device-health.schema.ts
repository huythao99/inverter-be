import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeviceHealthDocument = DeviceHealth & Document;

export interface BootEntry {
  at: Date;
  /** esp_reset_reason_t (1 power-on, 3 software, 4 panic, 6 task WDT, 9 brownout...). */
  reason: number;
  fw?: string;
}

/**
 * Latest health signals of one inverter, materialised from its telemetry
 * (last data time) and the trackLog reports it already sends (BOOT,
 * UART_STATS, STACK_STATS, MQTT_TRANSPORT...). One document per device.
 */
@Schema({ collection: 'device_health', timestamps: true })
export class DeviceHealth {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  /** Last telemetry frame seen by the backend (flushed once a minute). */
  @Prop({ type: Date, default: null })
  lastDataAt: Date | null;

  /** Firmware from the last BOOT report. */
  @Prop({ type: String, default: null })
  fw: string | null;

  /** Last 20 boots. */
  @Prop({
    type: [{ at: Date, reason: Number, fw: String, _id: false }],
    default: [],
  })
  boots: BootEntry[];

  @Prop({ type: String, default: null })
  transport: 'tls' | 'plain' | null;

  @Prop({ type: Date, default: null })
  transportAt: Date | null;

  @Prop({ type: [Date], default: [] })
  mqttFails: Date[];

  @Prop({ type: Object, default: null })
  uart: { at: Date; ok: number; bad: number; raw: string } | null;

  @Prop({ type: Object, default: null })
  badFrame: { at: Date; sample: string } | null;

  @Prop({ type: Object, default: null })
  heap: { at: Date; free: number; min: number; blk: number } | null;

  @Prop({ type: Number, default: null })
  rssi: number | null;

  @Prop({ type: Date, default: null })
  rssiAt: Date | null;

  @Prop({ type: Object, default: null })
  ota: { state: 'pending' | 'confirmed'; at: Date } | null;

  @Prop({ type: Object, default: null })
  lastLog: { code: string; message: string; at: Date } | null;

  createdAt: Date;
  updatedAt: Date;
}

export const DeviceHealthSchema = SchemaFactory.createForClass(DeviceHealth);
DeviceHealthSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceHealthSchema.index({ deviceId: 1 });
