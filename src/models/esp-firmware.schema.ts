import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EspFirmwareDocument = EspFirmware & Document;

/**
 * An ESP32 firmware build uploaded from the CMS, for one product (inverter,
 * charger, hybrid). The file lives on DO Spaces ({ESP_SPACES_PREFIX}/{product}/
 * {version}/firmware.bin, public-read) and is served through the firmware
 * server ({ESP_FIRMWARE_BASE_URL}/{product}/{version}/firmware.bin). At most
 * one build per product + channel is active; devices download the active
 * build of their product and channel (beta list -> beta).
 */
@Schema({ timestamps: true, collection: 'esp_firmwares' })
export class EspFirmware {
  _id: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['inverter', 'charger', 'hybrid'],
    default: 'inverter',
  })
  product: 'inverter' | 'charger' | 'hybrid';

  // "1.0.15" - the exact string the firmware reports (currentFirmwareVersion).
  @Prop({ required: true })
  version: string;

  // Public URL devices download.
  @Prop({ required: true })
  url: string;

  // Object key in the Spaces bucket.
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  sha256: string;

  @Prop({ required: true })
  md5: string;

  // Channels this build is active on for its product ([] = not offered).
  @Prop({ type: [String], enum: ['stable', 'beta'], default: [] })
  channels: ('stable' | 'beta')[];

  @Prop({ type: String, default: '' })
  notes: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EspFirmwareSchema = SchemaFactory.createForClass(EspFirmware);

// One build per product + version.
EspFirmwareSchema.index({ product: 1, version: 1 }, { unique: true });
