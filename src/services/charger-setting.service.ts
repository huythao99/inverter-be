import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import {
  ChargerSetting,
  ChargerSettingDocument,
} from '../models/charger-setting.schema';
import { MqttService } from './mqtt.service';

@Injectable()
export class ChargerSettingService {
  constructor(
    @InjectModel(ChargerSetting.name)
    private chargerSettingModel: Model<ChargerSettingDocument>,
    private mqttService: MqttService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private getCacheKey(userId: string, deviceId: string): string {
    return `/api/charger-setting/data/${userId}/${deviceId}`;
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<ChargerSetting | null> {
    return this.chargerSettingModel
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec();
  }

  /**
   * Upsert the raw 8-digit value and trigger the device to pull it.
   * The trigger is published to `charger/{uid}/{deviceId}/cmd/settings`.
   */
  async updateValueByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    value: string,
  ): Promise<ChargerSetting | null> {
    const updated = await this.chargerSettingModel
      .findOneAndUpdate(
        { userId, deviceId },
        { value, updatedAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();

    await this.cacheManager.del(this.getCacheKey(userId, deviceId));

    if (updated) {
      void this.mqttService.emitSyncChargerSettings(userId, deviceId);
    }

    return updated;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.chargerSettingModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
}
