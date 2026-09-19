import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChargerSettingDocument = ChargerSetting & Document;

@Schema({ timestamps: true })
export class ChargerSetting {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  // 8-digit "HHHHLLLL" string: HHHH = VBAT*10, LLLL = IBAT*10
  @Prop({ required: true })
  value: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const ChargerSettingSchema =
  SchemaFactory.createForClass(ChargerSetting);

ChargerSettingSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
