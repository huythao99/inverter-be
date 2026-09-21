import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BlacklistDevice,
  BlacklistDeviceDocument,
} from '../models/blacklist-device.schema';

@Injectable()
export class BlacklistDeviceService implements OnModuleInit {
  // Entries with NO userId => the deviceId is blocked for every user.
  private globalCache = new Set<string>();
  // Entries WITH a userId => only that "userId:deviceId" pair is blocked.
  private pairCache = new Set<string>();

  constructor(
    @InjectModel(BlacklistDevice.name)
    private blacklistDeviceModel: Model<BlacklistDeviceDocument>,
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
    const all = await this.blacklistDeviceModel.find().lean().exec();
    all.forEach((item) => this.addToCache(item.userId, item.deviceId));
  }

  // Blocked if the deviceId is blacklisted globally (entry without userId),
  // or if this specific userId+deviceId pair is blacklisted.
  isBlacklisted(deviceId: string, userId?: string): boolean {
    if (this.globalCache.has(deviceId)) return true;
    if (userId && this.pairCache.has(this.pairKey(userId, deviceId))) {
      return true;
    }
    return false;
  }

  async create(dto: {
    deviceId: string;
    userId?: string;
    reason?: string;
  }): Promise<BlacklistDevice> {
    const created = new this.blacklistDeviceModel(dto);
    const saved = await created.save();
    this.addToCache(dto.userId, dto.deviceId);
    return saved;
  }

  async findAll(): Promise<BlacklistDevice[]> {
    return this.blacklistDeviceModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async remove(id: string): Promise<BlacklistDevice | null> {
    const removed = await this.blacklistDeviceModel
      .findByIdAndDelete(id)
      .exec();
    if (!removed) return removed;

    // Only drop the cache entry if no other row still covers it.
    if (removed.userId) {
      const remaining = await this.blacklistDeviceModel
        .findOne({ deviceId: removed.deviceId, userId: removed.userId })
        .lean()
        .exec();
      if (!remaining) {
        this.pairCache.delete(this.pairKey(removed.userId, removed.deviceId));
      }
    } else {
      const remaining = await this.blacklistDeviceModel
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
    const result = await this.blacklistDeviceModel
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
