import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BetaFirmwareDevice,
  BetaFirmwareDeviceDocument,
} from '../models/beta-firmware-device.schema';

@Injectable()
export class BetaFirmwareDeviceService implements OnModuleInit {
  // Entries with NO userId => the deviceId gets beta firmware for every user.
  private globalCache = new Set<string>();
  // Entries WITH a userId => only that "userId:deviceId" pair gets beta.
  private pairCache = new Set<string>();

  constructor(
    @InjectModel(BetaFirmwareDevice.name)
    private betaFirmwareDeviceModel: Model<BetaFirmwareDeviceDocument>,
  ) {}

  private pairKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private addToCache(userId: string | undefined | null, deviceId: string) {
    if (userId) {
      this.pairCache.add(this.pairKey(userId, deviceId));
    } else {
      this.globalCache.add(deviceId);
    }
  }

  async onModuleInit() {
    const all = await this.betaFirmwareDeviceModel.find().lean().exec();
    all.forEach((item) => this.addToCache(item.userId, item.deviceId));
  }

  // Beta if the deviceId is enabled globally (entry without userId), or if this
  // specific userId+deviceId pair is enabled.
  isBeta(deviceId: string, userId?: string): boolean {
    if (this.globalCache.has(deviceId)) return true;
    if (userId && this.pairCache.has(this.pairKey(userId, deviceId))) {
      return true;
    }
    return false;
  }

  async create(dto: {
    deviceId: string;
    userId?: string;
    note?: string;
  }): Promise<BetaFirmwareDevice> {
    const created = new this.betaFirmwareDeviceModel(dto);
    const saved = await created.save();
    this.addToCache(dto.userId, dto.deviceId);
    return saved;
  }

  async findAll(): Promise<BetaFirmwareDevice[]> {
    return this.betaFirmwareDeviceModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async remove(id: string): Promise<BetaFirmwareDevice | null> {
    const removed = await this.betaFirmwareDeviceModel
      .findByIdAndDelete(id)
      .exec();
    if (!removed) return removed;

    // Only drop the cache entry if no other row still covers it.
    if (removed.userId) {
      const remaining = await this.betaFirmwareDeviceModel
        .findOne({ deviceId: removed.deviceId, userId: removed.userId })
        .lean()
        .exec();
      if (!remaining) {
        this.pairCache.delete(this.pairKey(removed.userId, removed.deviceId));
      }
    } else {
      const remaining = await this.betaFirmwareDeviceModel
        .findOne({
          deviceId: removed.deviceId,
          $or: [
            { userId: { $exists: false } },
            { userId: null },
            { userId: '' },
          ],
        })
        .lean()
        .exec();
      if (!remaining) {
        this.globalCache.delete(removed.deviceId);
      }
    }

    return removed;
  }

  async removeByDeviceId(deviceId: string): Promise<{ deletedCount: number }> {
    const result = await this.betaFirmwareDeviceModel
      .deleteMany({ deviceId })
      .exec();
    // Remove every cache entry (global + all user pairs) for this deviceId.
    this.globalCache.delete(deviceId);
    const suffix = `:${deviceId}`;
    for (const key of this.pairCache) {
      if (key.endsWith(suffix)) this.pairCache.delete(key);
    }
    return { deletedCount: result.deletedCount };
  }
}
