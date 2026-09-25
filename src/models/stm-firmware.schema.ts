import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StmFirmwareDocument = StmFirmware & Document;

export type StmProduct = 'inverter' | 'charger';
export type StmChannel = 'stable' | 'beta';

/**
 * An STM32 firmware image registered in the CMS. The file itself is hosted as
 * a static file on the firmware server ({STM_FIRMWARE_BASE_URL}/{product}/
 * {version}/app.bin, next to its app.json); only metadata
 * (validated against the real file at registration) is stored here.
 */
@Schema({ timestamps: true, collection: 'stm_firmwares' })
export class StmFirmware {
  _id: Types.ObjectId;

  // Which product's STM32 this image is for (inverter vs charger boards).
  @Prop({ required: true, enum: ['inverter', 'charger'] })
  product: StmProduct;

  // stable = everyone; beta = devices on the CMS beta list only.
  @Prop({ required: true, enum: ['stable', 'beta'], default: 'stable' })
  channel: StmChannel;

  // "major.voltage.patch": the 2nd number is the battery voltage class
  // (1 = 12V, 2 = 24V, 3 = 36V, 4 = 48V...). A device only gets images of
  // its own voltage class.
  @Prop({ required: true })
  version: string;

  // 1st number of the version: product generation / chip (3 = F303,
  // 2 = G431). Images of another major are never offered (other chip).
  @Prop({ required: true, type: Number })
  major: number;

  // 2nd number of the version, stored for querying.
  @Prop({ required: true, type: Number })
  voltageCode: number;

  // Public URL of app.bin.
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  size: number;

  // zlib/PNG CRC32 of app.bin, "0xXXXXXXXX".
  @Prop({ required: true })
  crc32: string;

  @Prop({ type: String, default: null })
  appBase: string | null;

  // Build time from app.json.
  @Prop({ type: String, default: null })
  built: string | null;

  @Prop({ type: String, default: '' })
  notes: string;

  // Disabled images are never offered to devices.
  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StmFirmwareSchema = SchemaFactory.createForClass(StmFirmware);

StmFirmwareSchema.index(
  { product: 1, channel: 1, version: 1 },
  { unique: true },
);
