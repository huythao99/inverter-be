import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ShareGroupDocument = ShareGroup & Document;

// A member device of a share group and its ratio (weight) in the split.
@Schema({ _id: false })
export class ShareMember {
  @Prop({ required: true })
  deviceId: string;

  @Prop({ required: true, type: Number, default: 0 })
  ratio: number;
}
export const ShareMemberSchema = SchemaFactory.createForClass(ShareMember);

/**
 * A user-selected set of devices that share a power/energy pool.
 *
 * pool        = Σ over ON members of (_p[idx2] + _energy[idx4]) of latest telemetry
 * computed_i  = round(pool × ratio_i / Σ ratios)   // grid-tie OFF members excluded
 */
@Schema({ timestamps: true })
export class ShareGroup {
  _id: Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop()
  name: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: [ShareMemberSchema], default: [] })
  members: ShareMember[];

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const ShareGroupSchema = SchemaFactory.createForClass(ShareGroup);

// Fast lookup of the enabled group a device belongs to.
ShareGroupSchema.index({ userId: 1, enabled: 1, 'members.deviceId': 1 });
