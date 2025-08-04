import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InverterDataDocument = InverterData & Document;

@Schema({ timestamps: true })
export class InverterData {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true })
  value: string;

  @Prop({ required: true, type: Number })
  totalACapacity: number;

  @Prop({ required: true, type: Number })
  totalA2Capacity: number;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const InverterDataSchema = SchemaFactory.createForClass(InverterData);
