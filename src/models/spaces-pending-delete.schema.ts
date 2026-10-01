import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SpacesPendingDeleteDocument = SpacesPendingDelete & Document;

/**
 * Firmware files to remove from DO Spaces once `deleteAfter` has passed
 * (see SpacesCleanupService). Kept in Mongo so a restart never forgets one.
 */
@Schema({ collection: 'spaces_pending_deletes', timestamps: true })
export class SpacesPendingDelete {
  // Which registry the files belonged to: the delete is skipped when a record
  // with the same product + version exists again (re-uploaded meanwhile).
  @Prop({ required: true, enum: ['esp', 'stm'] })
  kind: 'esp' | 'stm';

  @Prop({ required: true })
  product: string;

  @Prop({ required: true })
  version: string;

  @Prop({ type: [String], required: true })
  keys: string[];

  @Prop({ required: true, index: true })
  deleteAfter: Date;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ type: String, default: null })
  lastError: string | null;
}

export const SpacesPendingDeleteSchema =
  SchemaFactory.createForClass(SpacesPendingDelete);
