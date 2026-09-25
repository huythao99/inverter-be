import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  ChargerClaim,
  ChargerClaimDocument,
} from '../models/charger-claim.schema';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';
import { MqttAuthService } from './mqtt-auth.service';

// Long enough to connect the phone to the charger AP, enter the home WiFi and
// let the charger reach the Internet. Single use (per device) anyway.
const CLAIM_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class ChargerProvisionService {
  private readonly logger = new Logger(ChargerProvisionService.name);

  constructor(
    @InjectModel(ChargerClaim.name)
    private readonly claimModel: Model<ChargerClaimDocument>,
    @InjectModel(ChargerDevice.name)
    private readonly chargerDeviceModel: Model<ChargerDeviceDocument>,
    private readonly mqttAuthService: MqttAuthService,
  ) {}

  private static hash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /** New one-time code for userId (app, Firebase-authenticated). */
  async createClaim(
    userId: string,
  ): Promise<{ claim: string; expiresAt: Date }> {
    const claim = crypto.randomBytes(24).toString('base64url'); // 32 chars
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
    await this.claimModel.create({
      codeHash: ChargerProvisionService.hash(claim),
      userId,
      expiresAt,
    });
    return { claim, expiresAt };
  }

  /**
   * Charger exchanges a code for its own MQTT account.
   * - The code must be unexpired and unused, or used by this same device
   *   (the device retries when the response got lost).
   * - The charger is (re)registered to the code's owner; records of the same
   *   deviceId under other users are removed (ownership moves to whoever
   *   holds the device and a valid code).
   * - A new password replaces any previous account of this device.
   */
  async provision(
    deviceId: string,
    claim: string,
    firmwareVersion?: string,
  ): Promise<{ userId: string; mqttUsername: string; mqttPassword: string }> {
    const now = new Date();
    const doc = await this.claimModel
      .findOneAndUpdate(
        {
          codeHash: ChargerProvisionService.hash(claim),
          expiresAt: { $gt: now },
          $or: [{ usedAt: null }, { deviceId }],
        },
        { $set: { usedAt: now, deviceId } },
        { new: true },
      )
      .exec();
    if (!doc) {
      this.logger.warn(`Provision rejected for ${deviceId}: invalid claim`);
      throw new ForbiddenException('Invalid or expired claim');
    }
    const userId = doc.userId;

    const moved = await this.chargerDeviceModel
      .deleteMany({ deviceId, userId: { $ne: userId } })
      .exec();
    if (moved.deletedCount) {
      this.logger.log(`Charger ${deviceId} moved to user ${userId}`);
    }
    await this.chargerDeviceModel
      .findOneAndUpdate(
        { userId, deviceId },
        {
          $set: {
            userId,
            deviceId,
            updatedAt: now,
            ...(firmwareVersion ? { firmwareVersion } : {}),
          },
          $setOnInsert: { deviceName: deviceId },
        },
        { upsert: true, new: true },
      )
      .exec();

    const cred = await this.mqttAuthService.issueChargerCredentials(
      userId,
      deviceId,
    );
    this.logger.log(`Charger ${deviceId} provisioned for user ${userId}`);
    return { userId, mqttUsername: cred.username, mqttPassword: cred.password };
  }
}
