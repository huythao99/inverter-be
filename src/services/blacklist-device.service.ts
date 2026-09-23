import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  BlacklistDevice,
  BlacklistDeviceDocument,
} from '../models/blacklist-device.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';

// Emitted whenever a device's blacklist status changes. MqttService listens and
// publishes it to the device so the ESP32 can react. (EventEmitter avoids a
// circular dependency: MqttService already injects BlacklistDeviceService.)
export const BLACKLIST_CHANGED_EVENT = 'blacklist.changed';

export interface BlacklistChangedPayload {
  topic: string; // e.g. "inverter/{uid}/{deviceId}/blacklist"
  lock: boolean; // true = locked (blacklisted), false = unlocked
}

@Injectable()
export class BlacklistDeviceService implements OnModuleInit {
  // Entries with NO userId => the deviceId is blocked for every user.
  private globalCache = new Set<string>();
  // Entries WITH a userId => only that "userId:deviceId" pair is blocked.
  private pairCache = new Set<string>();

  constructor(
    @InjectModel(BlacklistDevice.name)
    private blacklistDeviceModel: Model<BlacklistDeviceDocument>,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    @InjectModel(ChargerDevice.name)
    private chargerDeviceModel: Model<ChargerDeviceDocument>,
    private eventEmitter: EventEmitter2,
  ) {}

  // Publish the lock/unlock event onto each owner's per-device topic
  // ({inverter|charger}/{uid}/{deviceId}/blacklist). When userId is known we
  // target it directly; for a global entry we look up the device's owner(s).
  private async emitChange(
    deviceId: string,
    blacklisted: boolean,
    userId?: string,
  ): Promise<void> {
    const type = deviceId.startsWith('ChargerControl') ? 'charger' : 'inverter';

    let uids: string[];
    if (userId) {
      uids = [userId];
    } else {
      const docs: Array<{ userId?: string }> =
        type === 'charger'
          ? await this.chargerDeviceModel
              .find({ deviceId }, { userId: 1 })
              .lean()
              .exec()
          : await this.inverterDeviceModel
              .find({ deviceId }, { userId: 1 })
              .lean()
              .exec();
      uids = docs.map((d) => d.userId).filter((u): u is string => !!u);
    }

    for (const uid of uids) {
      this.eventEmitter.emit(BLACKLIST_CHANGED_EVENT, {
        topic: `${type}/${uid}/${deviceId}/blacklist`,
        lock: blacklisted,
      });
    }
  }

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
    await this.emitChange(dto.deviceId, true, dto.userId);
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

    await this.emitChange(removed.deviceId, false, removed.userId);
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
    await this.emitChange(deviceId, false);
    return { deletedCount: result.deletedCount };
  }
}
