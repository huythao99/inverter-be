import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChargerClaimDocument = ChargerClaim & Document;

/**
 * One-time code that lets a charger join a user's account.
 *
 * The app (Firebase-authenticated) asks for a code and passes it to the
 * charger together with the home WiFi. The charger exchanges it once for its
 * own MQTT account (POST /api/charger-device/provision). The owner comes from
 * the code, never from what the device says.
 */
@Schema({ timestamps: true })
export class ChargerClaim {
  // SHA-256 of the code: a DB leak does not reveal usable codes.
  @Prop({ required: true, unique: true })
  codeHash: string;

  @Prop({ required: true, index: true })
  userId: string;

  // Mongo TTL index removes the document shortly after this date.
  @Prop({ required: true })
  expiresAt: Date;

  // Set when a charger used the code (then only that device may retry it).
  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  @Prop({ type: String, default: null })
  deviceId: string | null;
}

export const ChargerClaimSchema = SchemaFactory.createForClass(ChargerClaim);

ChargerClaimSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
