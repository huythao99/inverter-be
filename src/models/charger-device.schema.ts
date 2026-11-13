import { Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { DeviceBase } from './device-base.schema';

export type ChargerDeviceDocument = ChargerDevice & Document;

/**
 * MPPT charger (ChargerControl<N>). Fields: device-base.schema.ts.
 * Discriminator of Device, kind "charger", collection "devices".
 */
@Schema({ timestamps: true })
export class ChargerDevice extends DeviceBase {
  readonly kind?: 'charger';
}

export const ChargerDeviceSchema = SchemaFactory.createForClass(ChargerDevice);
