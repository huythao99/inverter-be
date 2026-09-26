import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

export type AuditDeviceKind = 'inverter' | 'charger';
export type AuditAction = 'settings' | 'schedule' | 'grid-tie';
/** Where the change came from. */
export type AuditSource = 'app' | 'web' | 'cms' | 'api' | 'system';

/**
 * One change of a device's settings / schedule / grid-tie state: who, when,
 * from where, before -> after. Kept 365 days (TTL index).
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  _id: Types.ObjectId;

  /** Owner of the device. */
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true, enum: ['inverter', 'charger'] })
  kind: AuditDeviceKind;

  @Prop({ required: true, enum: ['settings', 'schedule', 'grid-tie'] })
  action: AuditAction;

  @Prop({ required: true, enum: ['app', 'web', 'cms', 'api', 'system'] })
  source: AuditSource;

  /** Who did it: Firebase uid, CMS admin username... (may be unverified for
   *  the legacy unauthenticated app endpoints). */
  @Prop({ type: String, default: null })
  actor: string | null;

  /** Email / display name when known. */
  @Prop({ type: String, default: null })
  actorLabel: string | null;

  @Prop({ type: String, default: null })
  before: string | null;

  @Prop({ type: String, default: null })
  after: string | null;

  /** Human readable (Vietnamese) summary of the change. */
  @Prop({ type: String, default: '' })
  summary: string;

  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ userId: 1, deviceId: 1, createdAt: -1 });
AuditLogSchema.index({ deviceId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
