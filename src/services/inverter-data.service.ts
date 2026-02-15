/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  InverterData,
  InverterDataDocument,
} from '../models/inverter-data.schema';
import { MqttService } from './mqtt.service';
import { RedisDailyTotalsService } from './redis-daily-totals.service';

@Injectable()
export class InverterDataService implements OnModuleDestroy {
  private lastProcessed = new Map<
    string,
    { timestamp: number; data: string }
  >();
  private cleanupTimer: NodeJS.Timeout | null;
  private readonly DEDUPLICATION_WINDOW = 30000; // 10 seconds (increased from 5)
  private readonly MAX_MEMORY_ENTRIES = 1000; // Aggressive limit for VPS
  constructor(
    @InjectModel(InverterData.name)
    private inverterDataModel: Model<InverterDataDocument>,
    private mqttService: MqttService,
    private redisDailyTotalsService: RedisDailyTotalsService,
  ) {
    // Start aggressive memory cleanup every 30 seconds
    this.cleanupTimer = setInterval(() => {
      this.cleanupMemory();
    }, 30000);
  }

  // Aggressive cleanup for VPS environment
  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.lastProcessed.clear();
  }

  private cleanupMemory() {
    // Very aggressive cleanup for VPS
    if (this.lastProcessed.size > this.MAX_MEMORY_ENTRIES) {
      this.lastProcessed.clear();
    } else {
      // Remove old entries
      const now = Date.now();
      const cutoff = now - this.DEDUPLICATION_WINDOW;
      for (const [key, value] of this.lastProcessed.entries()) {
        if (value.timestamp < cutoff) {
          this.lastProcessed.delete(key);
        }
      }
    }
  }

  async create(
    createInverterDataDto: Partial<InverterData>,
  ): Promise<InverterData> {
    // Calculate capacity values if they exist
    // if (createInverterDataDto.totalACapacity !== undefined) {
    //   createInverterDataDto.totalACapacity =
    //     createInverterDataDto.totalACapacity / 1000000;
    // }
    // if (createInverterDataDto.totalA2Capacity !== undefined) {
    //   createInverterDataDto.totalA2Capacity =
    //     createInverterDataDto.totalA2Capacity / 1000000;
    // }
    const createdInverterData = new this.inverterDataModel(
      createInverterDataDto,
    );
    const savedData = await createdInverterData.save();
    // Emit MQTT event
    // if (createInverterDataDto.userId && createInverterDataDto.deviceId) {
    //   await this.mqttService.emitDataAdded(
    //     createInverterDataDto.userId,
    //     createInverterDataDto.deviceId,
    //     savedData,
    //   );
    // }

    return savedData;
  }

  async findAll(
    page: number = 1,
    limit: number = 100,
  ): Promise<{
    data: InverterData[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    // Use aggregation for better performance
    const result = await this.inverterDataModel
      .aggregate<{
        data: InverterData[];
        totalCount: [{ count: number }];
      }>([
        {
          $facet: {
            data: [
              { $sort: { updatedAt: -1, createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { __v: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: InverterData[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    // Use aggregation for better performance with filtering
    const result = await this.inverterDataModel
      .aggregate<{
        data: InverterData[];
        totalCount: [{ count: number }];
      }>([
        { $match: { userId, deviceId } },
        {
          $facet: {
            data: [
              { $sort: { updatedAt: -1, createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { __v: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(_id: string): Promise<InverterData | null> {
    return this.inverterDataModel.findById(_id).select('-__v').lean().exec();
  }

  async update(
    _id: string,
    updateInverterDataDto: Partial<InverterData>,
  ): Promise<InverterData | null> {
    updateInverterDataDto.updatedAt = new Date();
    const updatedData = await this.inverterDataModel
      .findByIdAndUpdate(_id, updateInverterDataDto, { new: true })
      .exec();

    // Emit MQTT event for data change
    if (updatedData && updatedData.userId && updatedData.deviceId) {
      await this.mqttService.emitDataChanged(
        updatedData.userId,
        updatedData.deviceId,
        updatedData,
      );
    }

    return updatedData;
  }

  async upsertByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    updateInverterDataDto: Partial<InverterData>,
  ): Promise<InverterData> {
    const updatedData = await this.inverterDataModel
      .findOneAndUpdate(
        { userId, deviceId },
        {
          $set: {
            ...updateInverterDataDto,
            userId,
            deviceId,
            updatedAt: new Date(),
          },
        },
        {
          new: true,
          upsert: true,
          lean: true,
        },
      )
      .select('-__v')
      .exec();

    return updatedData as InverterData;
  }

  async remove(_id: string): Promise<InverterData | null> {
    return this.inverterDataModel.findByIdAndDelete(_id).exec();
  }

  async findLatestByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterData | null> {
    return this.inverterDataModel
      .findOne({ userId, deviceId })
      .sort({ updatedAt: -1 })
      .select('-__v')
      .lean()
      .exec();
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterDataModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  private parseTotalsFromValue(value: string): {
    totalA: number;
    totalA2: number;
  } {
    if (!value || typeof value !== 'string') return { totalA: 0, totalA2: 0 };
    try {
      const parts = value.split('#');
      if (parts.length >= 10) {
        // Lấy 2 phần tử cuối và ép kiểu số ngay
        const totalA = parseFloat(parts[parts.length - 2]) || 0;
        const totalA2 = parseFloat(parts[parts.length - 1]) || 0;
        return {
          totalA: isFinite(totalA) ? totalA : 0,
          totalA2: isFinite(totalA2) ? totalA2 : 0,
        };
      }
    } catch {
      // Parsing failed, return defaults
    }
    return { totalA: 0, totalA2: 0 };
  }

  @OnEvent('inverter.data.received')
  async handleInverterDataReceived(payload: {
    currentUid: string;
    wifiSsid: string;
    data: any;
  }) {
    return;
    const key = `${payload.currentUid}-${payload.wifiSsid}`;
    // Use value field for deduplication instead of full JSON.stringify
    const valueString = payload.data?.value as string;
    if (!valueString) return; // Skip if no value

    const now = Date.now();

    // Check if same data was processed recently
    const lastProcess = this.lastProcessed.get(key);
    if (
      lastProcess &&
      now - lastProcess.timestamp < this.DEDUPLICATION_WINDOW &&
      lastProcess.data === valueString
    ) {
      return;
    }

    // Simple size-based cleanup - no expensive loops
    if (this.lastProcessed.size > this.MAX_MEMORY_ENTRIES) {
      this.lastProcessed.clear();
    }

    this.lastProcessed.set(key, { timestamp: now, data: valueString });

    try {
      const { totalA, totalA2 } = this.parseTotalsFromValue(valueString);

      // Skip processing if totalA >= 15000 or totalA2 >= 8000
      if (totalA >= 15000 || totalA2 >= 8000) {
        return;
      }

      // Convert to proper units (divide by 1,000,000) using decimal.js for precision
      // Ensure values are valid numbers before Decimal operations
      const safeTotalA = Number.isNaN(totalA) ? 0 : totalA;
      const safeTotalA2 = Number.isNaN(totalA2) ? 0 : totalA2;
      const currentTotalA = safeTotalA / 1000000;
      const currentTotalA2 = safeTotalA2 / 1000000;

      // Map MQTT data to InverterData schema
      const totalACapacity = Number(payload.data?.totalACapacity);
      const totalA2Capacity = Number(payload.data?.totalA2Capacity);
      const inverterDataUpdate = {
        userId: payload.currentUid,
        deviceId: payload.wifiSsid,
        value: valueString,
        totalACapacity: Number.isNaN(totalACapacity) ? 0 : totalACapacity,
        totalA2Capacity: Number.isNaN(totalA2Capacity) ? 0 : totalA2Capacity,
      };

      // Create new record for each data received
      // await this.create({
      //   ...inverterDataUpdate,
      //   userId: payload.currentUid,
      //   deviceId: payload.wifiSsid,
      // });

      // Previous upsert method (commented for rollback option)
      await this.upsertByUserIdAndDeviceId(
        payload.currentUid,
        payload.wifiSsid,
        inverterDataUpdate,
      );

      // Update daily totals using Redis cache (high performance)
      await this.redisDailyTotalsService.incrementDailyTotals(
        payload.currentUid,
        payload.wifiSsid,
        currentTotalA,
        currentTotalA2,
      );
    } catch (error) {
      console.error(
        `Error updating inverter data for ${payload.currentUid}/${payload.wifiSsid}:`,
        error,
      );
    }
  }
}
