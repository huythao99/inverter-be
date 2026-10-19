import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type HybridSettingDocument = HybridSetting & Document;

@Schema({ timestamps: true })
export class HybridSetting {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  // 8-digit "HHHHLLLL" (same as the charger): HHHH = VBAT*10, LLLL = IBAT*10.
  // Empty until the user saves one.
  @Prop({ type: String, default: '' })
  value: string;

  // Grid-tie ("hoà lưới") OFF: the device runs OUT=BAT (charge the battery
  // only). false = grid-tie ON: OUT=INV (feed the inverter / grid).
  // A status only: `value` is never changed by it.
  @Prop({ type: Boolean, default: false })
  gridTieOff: boolean;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const HybridSettingSchema = SchemaFactory.createForClass(HybridSetting);

HybridSettingSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
