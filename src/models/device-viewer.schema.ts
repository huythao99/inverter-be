import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ViewKind = 'inverter' | 'charger';

/**
 * Read-only access to ONE device, granted by its owner to a person identified
 * by email (they sign in with their own account). `viewerUid` is filled the
 * first time that person lists "shared with me" (needed by the MQTT ACL).
 */
@Schema({ timestamps: true, collection: 'device_viewers' })
export class DeviceViewer {
  @Prop({ required: true }) ownerUid: string;
  @Prop({ required: true, enum: ['inverter', 'charger'] }) kind: ViewKind;
  @Prop({ required: true }) deviceId: string;
  @Prop({ required: true, lowercase: true, trim: true }) viewerEmail: string;
  @Prop({ type: String, default: null }) viewerUid: string | null;
  @Prop({ type: Date, default: null }) lastSeenAt: Date | null;
  createdAt?: Date;
}
export type DeviceViewerDocument = DeviceViewer & Document;
export const DeviceViewerSchema = SchemaFactory.createForClass(DeviceViewer);
DeviceViewerSchema.index(
  { ownerUid: 1, kind: 1, deviceId: 1, viewerEmail: 1 },
  { unique: true },
);
DeviceViewerSchema.index({ viewerEmail: 1 });
DeviceViewerSchema.index({ viewerUid: 1 });

/** Public "anyone with the link" read-only view of ONE device. */
@Schema({ timestamps: true, collection: 'device_share_links' })
export class DeviceShareLink {
  @Prop({ required: true }) ownerUid: string;
  @Prop({ required: true, enum: ['inverter', 'charger'] }) kind: ViewKind;
  @Prop({ required: true }) deviceId: string;
  @Prop({ required: true, unique: true }) token: string;
  /** null = never expires. */
  @Prop({ type: Date, default: null }) expiresAt: Date | null;
  createdAt?: Date;
}
export type DeviceShareLinkDocument = DeviceShareLink & Document;
export const DeviceShareLinkSchema =
  SchemaFactory.createForClass(DeviceShareLink);
DeviceShareLinkSchema.index(
  { ownerUid: 1, kind: 1, deviceId: 1 },
  { unique: true },
);
