import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { DeviceBase } from './device-base.schema';

export const DEVICE_KINDS = ['inverter', 'charger', 'hybrid'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export type DeviceDocument = Device & Document;

/**
 * Every device entry of every type, one collection ("devices"), told apart
 * by `kind`. InverterDevice / ChargerDevice / HybridDevice are Mongoose
 * discriminators of this model (registered in DevicesModule): their queries
 * add `kind` by themselves and a document they create gets it, so services
 * keep using the typed model. Use this base model for anything across types
 * (which kind is this id, every device of a user).
 *
 * The device type is no longer inferred from the id prefix (GTIControl /
 * ChargerControl / HybridControl): a brand may use its own prefix.
 */
@Schema({ timestamps: true, collection: 'devices', discriminatorKey: 'kind' })
export class Device extends DeviceBase {
  @Prop({ type: String, required: true, enum: DEVICE_KINDS })
  kind: DeviceKind;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);

// One entry per (owner, device id) across all types; lookups by id alone
// (owners of an id, which kind) use the second one.
DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ deviceId: 1 });
