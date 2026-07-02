import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InverterSettingDocument = InverterSetting & Document;

@Schema({ timestamps: true })
export class InverterSetting {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  value: string;

  // Grid-tie ("hoà lưới") status. false = grid connected (default),
  // true = tắt hoà lưới. The real `value` above is preserved either way.
  @Prop({ default: false })
  gridTieOff: boolean;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterSettingSchema =
  SchemaFactory.createForClass(InverterSetting);

// Tạo compound unique index cho userId và deviceId
InverterSettingSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
