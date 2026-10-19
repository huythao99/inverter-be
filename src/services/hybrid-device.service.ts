import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  HybridDevice,
  HybridDeviceDocument,
} from '../models/hybrid-device.schema';
import {
  ChargerClaim,
  ChargerClaimDocument,
} from '../models/charger-claim.schema';
import { MqttAuthService } from './mqtt-auth.service';

// Same as the charger: time to join the device AP, enter the home WiFi and
// let the device reach the Internet. Single use (per device) anyway.
const CLAIM_TTL_MS = 30 * 60 * 1000;

const hash = (code: string) =>
  crypto.createHash('sha256').update(code).digest('hex');

/**
 * Hybrid devices of a user + setup (claim -> own MQTT account).
 *
 * Setup codes live in the same collection as the charger's (`chargerclaims`):
 * a code only says "this user may add one device"; the device type is decided
 * by which provision endpoint the device calls.
 */
@Injectable()
export class HybridDeviceService {
  private readonly logger = new Logger(HybridDeviceService.name);

  constructor(
    @InjectModel(HybridDevice.name)
    private readonly deviceModel: Model<HybridDeviceDocument>,
    @InjectModel(ChargerClaim.name)
    private readonly claimModel: Model<ChargerClaimDocument>,
    private readonly mqttAuthService: MqttAuthService,
  ) {}

  findByUserId(userId: string): Promise<HybridDevice[]> {
    return this.deviceModel
      .find({ userId })
      .sort({ createdAt: 1 })
      .lean()
      .exec() as Promise<HybridDevice[]>;
  }

  findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<HybridDevice | null> {
    return this.deviceModel
      .findOne({ userId, deviceId })
      .lean()
      .exec() as Promise<HybridDevice | null>;
  }

  update(
    userId: string,
    deviceId: string,
    patch: { deviceName?: string; description?: string },
  ): Promise<HybridDevice | null> {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof patch.deviceName === 'string' && patch.deviceName.trim()) {
      $set.deviceName = patch.deviceName.trim().slice(0, 100);
    }
    if (typeof patch.description === 'string') {
      $set.description = patch.description.slice(0, 500);
    }
    return this.deviceModel
      .findOneAndUpdate({ userId, deviceId }, { $set }, { new: true })
      .lean()
      .exec() as Promise<HybridDevice | null>;
  }

  updateFirmwareVersion(
    userId: string,
    deviceId: string,
    firmwareVersion: string,
  ): Promise<HybridDevice | null> {
    return this.deviceModel
      .findOneAndUpdate(
        { userId, deviceId },
        { $set: { firmwareVersion, updatedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec() as Promise<HybridDevice | null>;
  }

  /** Remove from the account and cut the device off the broker. */
  async remove(userId: string, deviceId: string): Promise<HybridDevice | null> {
    const removed = (await this.deviceModel
      .findOneAndDelete({ userId, deviceId })
      .lean()
      .exec()) as HybridDevice | null;
    if (removed) {
      await this.mqttAuthService.revokeHybridCredentials(deviceId, userId);
    }
    return removed;
  }

  /** New one-time setup code for userId (app/web, Firebase-authenticated). */
  async createClaim(
    userId: string,
  ): Promise<{ claim: string; expiresAt: Date }> {
    const claim = crypto.randomBytes(24).toString('base64url'); // 32 chars
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
    await this.claimModel.create({ codeHash: hash(claim), userId, expiresAt });
    return { claim, expiresAt };
  }

  /**
   * The device exchanges a setup code for its own MQTT account (same rules
   * as ChargerProvisionService.provision): unexpired code, unused or used by
   * this same device; the device moves to the code's owner; a new password
   * replaces any previous account of this device.
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
          codeHash: hash(claim),
          expiresAt: { $gt: now },
          $or: [{ usedAt: null }, { deviceId }],
        },
        { $set: { usedAt: now, deviceId } },
        { new: true },
      )
      .exec();
    if (!doc) {
      this.logger.warn(`Provision rejected for hybrid ${deviceId}`);
      throw new ForbiddenException('Invalid or expired claim');
    }
    const userId = doc.userId;

    const moved = await this.deviceModel
      .deleteMany({ deviceId, userId: { $ne: userId } })
      .exec();
    if (moved.deletedCount) {
      this.logger.log(`Hybrid ${deviceId} moved to user ${userId}`);
    }
    await this.deviceModel
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

    const cred = await this.mqttAuthService.issueHybridCredentials(
      userId,
      deviceId,
    );
    this.logger.log(`Hybrid ${deviceId} provisioned for user ${userId}`);
    return { userId, mqttUsername: cred.username, mqttPassword: cred.password };
  }
}
