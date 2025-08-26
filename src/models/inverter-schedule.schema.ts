import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InverterScheduleDocument = InverterSchedule & Document;

@Schema({ timestamps: true })
export class InverterSchedule {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  schedule: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterScheduleSchema =
  SchemaFactory.createForClass(InverterSchedule);

// Tạo compound unique index cho userId và deviceId
InverterScheduleSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
