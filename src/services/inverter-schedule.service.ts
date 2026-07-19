import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InverterSchedule,
  InverterScheduleDocument,
} from '../models/inverter-schedule.schema';
import { MqttService } from './mqtt.service';

interface CacheEntry {
  data: InverterSchedule | null;
  timestamp: number;
}

@Injectable()
export class InverterScheduleService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 10000; // 10 seconds cache

  constructor(
    @InjectModel(InverterSchedule.name)
    private inverterScheduleModel: Model<InverterScheduleDocument>,
    private mqttService: MqttService,
  ) {}

  private getCacheKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private invalidateCache(userId: string, deviceId: string): void {
    this.cache.delete(this.getCacheKey(userId, deviceId));
  }

  async create(
    createInverterScheduleDto: Partial<InverterSchedule>,
  ): Promise<InverterSchedule> {
    if (
      createInverterScheduleDto.userId &&
      createInverterScheduleDto.deviceId
    ) {
      this.invalidateCache(
        createInverterScheduleDto.userId,
        createInverterScheduleDto.deviceId,
      );
    }
    const createdInverterSchedule = new this.inverterScheduleModel(
      createInverterScheduleDto,
    );
    const saved = await createdInverterSchedule.save();

    if (
      createInverterScheduleDto.userId &&
      createInverterScheduleDto.deviceId
    ) {
      void this.mqttService.emitSyncSchedule(
        createInverterScheduleDto.userId,
        createInverterScheduleDto.deviceId,
      );
    }

    return saved;
  }

  async findAll(): Promise<InverterSchedule[]> {
    return this.inverterScheduleModel.find().lean().maxTimeMS(2000).exec();
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterSchedule | null> {
    const cacheKey = this.getCacheKey(userId, deviceId);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const result = await this.inverterScheduleModel
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec();

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  async findOne(_id: string): Promise<InverterSchedule | null> {
    return this.inverterScheduleModel.findById(_id).exec();
  }

  async update(
    _id: string,
    updateInverterScheduleDto: Partial<InverterSchedule>,
  ): Promise<InverterSchedule | null> {
    updateInverterScheduleDto.updatedAt = new Date();
    const result = await this.inverterScheduleModel
      .findByIdAndUpdate(_id, updateInverterScheduleDto, { new: true })
      .exec();

    if (result) {
      this.invalidateCache(result.userId, result.deviceId);
      void this.mqttService.emitSyncSchedule(result.userId, result.deviceId);
    }

    return result;
  }

  async remove(_id: string): Promise<InverterSchedule | null> {
    return this.inverterScheduleModel.findByIdAndDelete(_id).exec();
  }

  async updateByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    updateInverterScheduleDto: Partial<InverterSchedule>,
  ): Promise<InverterSchedule | null> {
    updateInverterScheduleDto.updatedAt = new Date();
    this.invalidateCache(userId, deviceId);
    const result = await this.inverterScheduleModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterScheduleDto, {
        new: true,
      })
      .exec();

    if (result) {
      void this.mqttService.emitSyncSchedule(userId, deviceId);
    }

    return result;
  }

  async updateScheduleByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    schedule: string,
  ): Promise<InverterSchedule | null> {
    this.invalidateCache(userId, deviceId);
    const updatedSchedule = await this.inverterScheduleModel
      .findOneAndUpdate(
        { userId, deviceId },
        { schedule, updatedAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();

    if (updatedSchedule) {
      void this.mqttService.emitSyncSchedule(userId, deviceId);
    }

    return updatedSchedule;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    this.cache.clear();
    const result = await this.inverterScheduleModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
}
