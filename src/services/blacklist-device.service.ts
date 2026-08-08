import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BlacklistDevice,
  BlacklistDeviceDocument,
} from '../models/blacklist-device.schema';

@Injectable()
export class BlacklistDeviceService implements OnModuleInit {
  private cache = new Set<string>();

  constructor(
    @InjectModel(BlacklistDevice.name)
    private blacklistDeviceModel: Model<BlacklistDeviceDocument>,
  ) {}

  async onModuleInit() {
    const all = await this.blacklistDeviceModel.find().lean().exec();
    all.forEach((item) => this.cache.add(item.deviceId));
  }

  isBlacklisted(deviceId: string): boolean {
    return this.cache.has(deviceId);
  }

  async create(dto: {
    deviceId: string;
    userId?: string;
    reason?: string;
  }): Promise<BlacklistDevice> {
    const created = new this.blacklistDeviceModel(dto);
    const saved = await created.save();
    this.cache.add(dto.deviceId);
    return saved;
  }

  async findAll(): Promise<BlacklistDevice[]> {
    return this.blacklistDeviceModel.find().sort({ createdAt: -1 }).lean().exec();
  }

  async remove(id: string): Promise<BlacklistDevice | null> {
    const removed = await this.blacklistDeviceModel
      .findByIdAndDelete(id)
      .exec();
    if (removed) {
      const remaining = await this.blacklistDeviceModel
        .findOne({ deviceId: removed.deviceId })
        .lean()
        .exec();
      if (!remaining) {
        this.cache.delete(removed.deviceId);
      }
    }
    return removed;
  }

  async removeByDeviceId(deviceId: string): Promise<{ deletedCount: number }> {
    const result = await this.blacklistDeviceModel
      .deleteMany({ deviceId })
      .exec();
    this.cache.delete(deviceId);
    return { deletedCount: result.deletedCount };
  }
}
