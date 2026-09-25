import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MqttCredentialDocument = MqttCredential & Document;

@Schema({ timestamps: true })
export class MqttCredential {
  _id: Types.ObjectId;

  // One credential per user AND kind (unique compound index below).
  @Prop({ required: true, index: true })
  userId: string;

  // ha  = Home Assistant (reads/writes the user's inverter_ha/... topics)
  // app = mobile app + web of that user (read-only, its own devices)
  // cms = CMS live view (read-only, all devices); userId = '__cms__'
  @Prop({ type: String, enum: ['ha', 'app', 'cms'], default: 'ha' })
  kind: 'ha' | 'app' | 'cms';

  @Prop({ required: true, unique: true, index: true })
  mqttUsername: string;

  @Prop({ required: true })
  mqttPasswordHash: string;

  @Prop({ required: true })
  mqttPasswordEncrypted: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: [String], default: [] })
  allowedDevices: string[];

  @Prop({ default: Date.now })
  lastUsedAt: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const MqttCredentialSchema =
  SchemaFactory.createForClass(MqttCredential);

// Index for fast lookups
MqttCredentialSchema.index({ mqttUsername: 1, isActive: 1 });
MqttCredentialSchema.index({ userId: 1, kind: 1 }, { unique: true });
