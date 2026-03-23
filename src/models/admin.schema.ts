import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AdminDocument = Admin & Document;

export type AdminRole = 'super_admin' | 'admin';

@Schema({ timestamps: true })
export class Admin {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  username: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, enum: ['super_admin', 'admin'], default: 'admin' })
  role: AdminRole;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);

// Index for fast lookups
AdminSchema.index({ username: 1, isActive: 1 });
