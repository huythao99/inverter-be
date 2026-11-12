import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { DeviceBase } from './device-base.schema';

export type ChargerDeviceDocument = ChargerDevice & Document;

/** MPPT charger (ChargerControl<N>). Fields: device-base.schema.ts. */
@Schema({ timestamps: true, collection: 'chargerdevices' })
export class ChargerDevice extends DeviceBase {}

export const ChargerDeviceSchema = SchemaFactory.createForClass(ChargerDevice);

ChargerDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
