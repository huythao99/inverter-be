import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MqttCredentialDocument = MqttCredential & Document;

@Schema({ timestamps: true })
export class MqttCredential {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  userId: string;

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
