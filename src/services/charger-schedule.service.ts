import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChargerSchedule,
  ChargerScheduleDocument,
} from '../models/charger-schedule.schema';
import { MqttService } from './mqtt.service';

interface CacheEntry {
  data: ChargerSchedule | null;
  timestamp: number;
}

@Injectable()
export class ChargerScheduleService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 10000;

  constructor(
    @InjectModel(ChargerSchedule.name)
    private chargerScheduleModel: Model<ChargerScheduleDocument>,
    private mqttService: MqttService,
  ) {}

  private getCacheKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private invalidateCache(userId: string, deviceId: string): void {
    this.cache.delete(this.getCacheKey(userId, deviceId));
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<ChargerSchedule | null> {
    const cacheKey = this.getCacheKey(userId, deviceId);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const result = await this.chargerScheduleModel
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec();

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Upsert the schedule string and trigger the device to pull it.
   * The trigger is published to `charger/{uid}/{deviceId}/cmd/schedule`.
   */
  async updateScheduleByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    schedule: string,
  ): Promise<ChargerSchedule | null> {
    this.invalidateCache(userId, deviceId);
    const updated = await this.chargerScheduleModel
      .findOneAndUpdate(
        { userId, deviceId },
        { schedule, updatedAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();

    if (updated) {
      void this.mqttService.emitSyncChargerSchedule(userId, deviceId);
    }

    return updated;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    this.cache.clear();
    const result = await this.chargerScheduleModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
}
