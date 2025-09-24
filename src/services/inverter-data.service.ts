/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { Decimal } from 'decimal.js';
import {
  InverterData,
  InverterDataDocument,
} from '../models/inverter-data.schema';
import { MqttService } from './mqtt.service';
import { DailyTotalsService } from './daily-totals.service';
import { RedisDailyTotalsService } from './redis-daily-totals.service';

@Injectable()
export class InverterDataService {
  private lastProcessed = new Map<
    string,
    { timestamp: number; data: string }
  >();
  constructor(
    @InjectModel(InverterData.name)
    private inverterDataModel: Model<InverterDataDocument>,
    private mqttService: MqttService,
    private dailyTotalsService: DailyTotalsService,
    private redisDailyTotalsService: RedisDailyTotalsService,
  ) {}

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
          lean: false,
          runValidators: false,
        },
      )
      .select('-__v')
      .exec();

    return updatedData;
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
    try {
      const parts = value.split('#');
      if (parts.length >= 10) {
        const totalA = parseFloat(parts[parts.length - 2]) || 0; // Second to last value
        const totalA2 = parseFloat(parts[parts.length - 1]) || 0; // Last value
        return { totalA, totalA2 };
      }
    } catch (error) {
      console.error('Error parsing totals from value:', error);
    }
    return { totalA: 0, totalA2: 0 };
  }

  @OnEvent('inverter.data.received')
  async handleInverterDataReceived(payload: {
    currentUid: string;
    wifiSsid: string;
    data: any;
  }) {
    const key = `${payload.currentUid}-${payload.wifiSsid}`;
    const dataString = JSON.stringify(payload.data);
    const now = Date.now();

    // // Log data received from GTIControl409
    // if (payload.wifiSsid === 'GTIControl409') {
    //   console.log('Raw Data:', JSON.stringify(payload.data?.value, null, 2));
    // }

    // Check if same data was processed recently (within 5 seconds)
    const lastProcess = this.lastProcessed.get(key);
    if (
      lastProcess &&
      now - lastProcess.timestamp < 5000 &&
      lastProcess.data === dataString
    ) {
      return;
    }

    this.lastProcessed.set(key, { timestamp: now, data: dataString });

    try {
      const valueString =
        (payload.data?.value as string) || JSON.stringify(payload.data);
      const { totalA, totalA2 } = this.parseTotalsFromValue(valueString);
      // Convert to proper units (divide by 1,000,000) using decimal.js for precision
      const currentTotalA = new Decimal(totalA).div(1000000).toNumber();
      const currentTotalA2 = new Decimal(totalA2).div(1000000).toNumber();

      // Map MQTT data to InverterData schema
      const inverterDataUpdate = {
        userId: payload.currentUid,
        deviceId: payload.wifiSsid,
        value: valueString,
        totalACapacity: payload.data?.totalACapacity || 0,
        totalA2Capacity: payload.data?.totalA2Capacity || 0,
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
      const dailyTotalsResult = await this.redisDailyTotalsService.incrementDailyTotals(
        payload.currentUid,
        payload.wifiSsid,
        currentTotalA,
        currentTotalA2,
      );

      // Log daily totals update for GTIControl409
      // if (payload.wifiSsid === 'GTIControl409') {
      //   console.log('=== GTIControl409 Daily Totals Update ===');
      //   console.log('Increment totalA:', currentTotalA);
      //   console.log('Increment totalA2:', currentTotalA2);
      //   console.log('New daily totalA:', dailyTotalsResult.totalA);
      //   console.log('New daily totalA2:', dailyTotalsResult.totalA2);
      //   console.log('==========================================');
      // }
    } catch (error) {
      console.error(
        `Error updating inverter data for ${payload.currentUid}/${payload.wifiSsid}:`,
        error,
      );
    }
  }
}
