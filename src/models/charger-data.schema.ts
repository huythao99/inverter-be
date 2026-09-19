import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChargerDataDocument = ChargerData & Document;

/**
 * Latest known state of a charger, merged from the three `data` message types
 * the firmware publishes (tlm / cfg / info) plus the `status` heartbeat.
 * One document per userId+deviceId (upserted on every message).
 *
 * Every telemetry field is stored as a string exactly as sent by the device
 * (the firmware sends numbers as strings; NAN is possible). Clients parse.
 */
@Schema({ timestamps: true })
export class ChargerData {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  // ---- Telemetry (type=tlm) ----
  @Prop() st?: string; // RUN / IDLE / OFF / CAL / FLT
  @Prop() flt?: string; // 0 = ok, 1 = hardware fault
  @Prop() temp?: string; // heatsink temp °C (field "T")
  @Prop() mode?: string; // MPPT / CV / CC
  @Prop() ms?: string; // WAIT / SCAN / TRACK / LIM
  @Prop() vpv?: string; // PV voltage V
  @Prop() ipv?: string; // PV current A
  @Prop() ppv?: string; // PV power W
  @Prop() vbat?: string; // measured battery voltage V
  @Prop() ibat?: string; // measured battery current A
  @Prop() il?: string; // inductor current A
  @Prop() duty?: string; // PWM duty 0-1
  @Prop() vref?: string; // target PV voltage V

  // ---- Config (type=cfg) — actual applied values on the machine ----
  @Prop() cfgVbat?: string; // charge voltage setpoint (CV) V
  @Prop() cfgIbat?: string; // max charge current (CC) A
  @Prop() cfgPbat?: string; // power W
  @Prop() src?: string; // ESP (cloud control) | LOCAL (machine only)

  // ---- Info (type=info) ----
  @Prop() dev?: string; // e.g. MPPT
  @Prop() proto?: string;
  @Prop() fw?: string;
  @Prop() hw?: string;

  // ---- Meta ----
  @Prop() lastType?: string; // last data message type seen (tlm/cfg/info)
  @Prop() raw?: string; // last raw STM32 frame
  @Prop({ default: 'offline' })
  status: string; // online | offline (derived from heartbeat)
  @Prop({ default: Date.now })
  lastSeenAt: Date; // last time any message was received

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const ChargerDataSchema = SchemaFactory.createForClass(ChargerData);

ChargerDataSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
ChargerDataSchema.index({ userId: 1, deviceId: 1, updatedAt: -1 });
