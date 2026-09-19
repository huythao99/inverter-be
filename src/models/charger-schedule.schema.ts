import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChargerScheduleDocument = ChargerSchedule & Document;

@Schema({ timestamps: true })
export class ChargerSchedule {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  // "start=HH:MM&end=HH:MM&value=HHHHLLLL[#...]" — max 10 segments
  @Prop({ required: true })
  schedule: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const ChargerScheduleSchema =
  SchemaFactory.createForClass(ChargerSchedule);

ChargerScheduleSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
