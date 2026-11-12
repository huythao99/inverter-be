import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { StmDeviceBase } from './device-base.schema';

export type InverterDeviceDocument = InverterDevice & Document;

/** Grid-tie inverter (GTIControl<N>): base + STM32 fields in device-base. */
@Schema({ timestamps: true, collection: 'inverterdevices' })
export class InverterDevice extends StmDeviceBase {
  // True once the device has reported the 12-number (pre-calculated daily
  // totals) format at least once. Marks it as an autoCalculate device.
  @Prop({ type: Boolean, default: false })
  autoCalculate: boolean;

  // ESP32 <-> STM32 link protocol, set from the CMS and pushed to the device
  // (retained inverter/{uid}/{dev}/cmd/stm-protocol {"mode"}):
  //   auto   = the ESP32 detects it at boot (default),
  //   new    = "*VVVV@PPPP#" straight on the UART,
  //   legacy = first boards: STM_START/STM_READY handshake + raw 8 digits.
  @Prop({ type: String, enum: ['auto', 'new', 'legacy'], default: 'auto' })
  stmProtocol: 'auto' | 'new' | 'legacy';
}

export const InverterDeviceSchema =
  SchemaFactory.createForClass(InverterDevice);

InverterDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
