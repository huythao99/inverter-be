import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import {
  InverterSetting,
  InverterSettingDocument,
} from '../models/inverter-setting.schema';
import { MqttService } from './mqtt.service';
import { GRID_TIE_OFF_VALUE } from '../constants/grid-tie.constants';

@Injectable()
export class InverterSettingService {
  constructor(
    @InjectModel(InverterSetting.name)
    private inverterSettingModel: Model<InverterSettingDocument>,
    private mqttService: MqttService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private getCacheKey(userId: string, deviceId: string): string {
    return `/api/inverter-setting/data/${userId}/${deviceId}`;
  }

  async create(
    createInverterSettingDto: Partial<InverterSetting>,
  ): Promise<InverterSetting> {
    const createdInverterSetting = new this.inverterSettingModel(
      createInverterSettingDto,
    );
    return createdInverterSetting.save();
  }

  async findAll(): Promise<InverterSetting[]> {
    return this.inverterSettingModel.find().lean().maxTimeMS(2000).exec();
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterSetting | null> {
    return this.inverterSettingModel
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec();
  }

  async findOne(_id: string): Promise<InverterSetting | null> {
    return this.inverterSettingModel.findById(_id).exec();
  }

  async update(
    _id: string,
    updateInverterSettingDto: Partial<InverterSetting>,
  ): Promise<InverterSetting | null> {
    updateInverterSettingDto.updatedAt = new Date();
    const result = await this.inverterSettingModel
      .findByIdAndUpdate(_id, updateInverterSettingDto, { new: true })
      .exec();

    if (result) {
      await this.cacheManager.del(
        this.getCacheKey(result.userId, result.deviceId),
      );
      void this.mqttService.emitSyncSettings(result.userId, result.deviceId);
    }

    return result;
  }

  async remove(_id: string): Promise<InverterSetting | null> {
    return this.inverterSettingModel.findByIdAndDelete(_id).exec();
  }

  async updateByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    updateInverterSettingDto: Partial<InverterSetting>,
  ): Promise<InverterSetting | null> {
    updateInverterSettingDto.updatedAt = new Date();
    const result = await this.inverterSettingModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterSettingDto, {
        new: true,
      })
      .exec();

    // Invalidate cache so next GET is fresh
    await this.cacheManager.del(this.getCacheKey(userId, deviceId));

    if (result) {
      void this.mqttService.emitSyncSettings(userId, deviceId);
    }

    return result;
  }

  async updateValueByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    value: string,
  ): Promise<InverterSetting | null> {
    const updatedSetting = await this.inverterSettingModel
      .findOneAndUpdate(
        { userId, deviceId },
        { value, updatedAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();

    // Invalidate cache so next GET is fresh
    await this.cacheManager.del(this.getCacheKey(userId, deviceId));

    if (updatedSetting) {
      void this.mqttService.emitSyncSettings(userId, deviceId);
    }

    return updatedSetting;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterSettingModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  // Grid-tie status is the source of truth in MongoDB; GridTieService caches it
  // in Redis. Defaults to false (grid-tie ON) when no setting exists yet.
  async getGridTieOffFromDb(
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    const doc = await this.inverterSettingModel
      .findOne({ userId, deviceId }, { gridTieOff: 1 })
      .lean()
      .maxTimeMS(2000)
      .exec();
    return doc?.gridTieOff ?? false;
  }

  async setGridTieOffInDb(
    userId: string,
    deviceId: string,
    off: boolean,
  ): Promise<InverterSetting | null> {
    const update: Record<string, unknown> = {
      $set: { gridTieOff: off, updatedAt: new Date() },
    };
    const options: Record<string, unknown> = { new: true };
    if (off) {
      // Allow turning grid-tie off on a device with no setting yet; the stored
      // value defaults to the OFF command until the app writes the real one.
      options.upsert = true;
      update.$setOnInsert = { value: GRID_TIE_OFF_VALUE };
    }
    const result = await this.inverterSettingModel
      .findOneAndUpdate({ userId, deviceId }, update, options)
      .exec();

    // Invalidate the HTTP GET cache so the next poll reflects the new status.
    await this.cacheManager.del(this.getCacheKey(userId, deviceId));

    if (result) {
      void this.mqttService.emitSyncSettings(userId, deviceId);
    }

    return result;
  }
}
