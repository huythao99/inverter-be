import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  InverterData,
  InverterDataDocument,
} from '../models/inverter-data.schema';
import { MqttService } from './mqtt.service';

@Injectable()
export class InverterDataService {
  constructor(
    @InjectModel(InverterData.name)
    private inverterDataModel: Model<InverterDataDocument>,
    private mqttService: MqttService,
  ) {}

  async create(
    createInverterDataDto: Partial<InverterData>,
  ): Promise<InverterData> {
    // Calculate capacity values if they exist
    if (createInverterDataDto.totalACapacity !== undefined) {
      createInverterDataDto.totalACapacity =
        createInverterDataDto.totalACapacity / 1000000;
    }
    if (createInverterDataDto.totalA2Capacity !== undefined) {
      createInverterDataDto.totalA2Capacity =
        createInverterDataDto.totalA2Capacity / 1000000;
    }
    const createdInverterData = new this.inverterDataModel(
      createInverterDataDto,
    );
    const savedData = await createdInverterData.save();
    console.log('call create data');
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

  async findAll(): Promise<InverterData[]> {
    return this.inverterDataModel.find().exec();
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

    const [data, total] = await Promise.all([
      this.inverterDataModel
        .find({ userId, deviceId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.inverterDataModel.countDocuments({ userId, deviceId }).exec(),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(_id: string): Promise<InverterData | null> {
    return this.inverterDataModel.findById(_id).exec();
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

  @OnEvent('inverter.data.received')
  async handleInverterDataReceived(payload: {
    currentUid: string;
    wifiSsid: string;
    data: any;
  }) {
    try {
      console.log(
        `Processing MQTT data for inverter/${payload.currentUid}/${payload.wifiSsid}/data`,
      );
      // Map MQTT data to InverterData schema
      const inverterDataUpdate = {
        userId: payload.currentUid,
        deviceId: payload.wifiSsid,
        value: payload.data?.value || JSON.stringify(payload.data),
        totalACapacity: payload.data?.totalACapacity || 0,
        totalA2Capacity: payload.data?.totalA2Capacity || 0,
      };

      // Upsert the inverter data using optimized method
      const result = await this.upsertByUserIdAndDeviceId(
        payload.currentUid,
        payload.wifiSsid,
        inverterDataUpdate,
      );

      console.log(
        `Successfully upserted data for ${payload.currentUid}/${payload.wifiSsid}:`,
        result._id,
      );

    } catch (error) {
      console.error(
        `Error updating inverter data for ${payload.currentUid}/${payload.wifiSsid}:`,
        error,
      );
    }
  }
}
