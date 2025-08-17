import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import { MqttService } from './mqtt.service';

@Injectable()
export class InverterDeviceService {
  constructor(
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    private mqttService: MqttService,
  ) {}

  async create(
    createInverterDeviceDto: Partial<InverterDevice>,
  ): Promise<InverterDevice> {
    // Use upsert to create or update if userId and deviceId combination exists
    const deviceData = {
      ...createInverterDeviceDto,
      updatedAt: new Date(),
    };
    const savedDevice = await this.inverterDeviceModel
      .findOneAndUpdate(
        { 
          userId: createInverterDeviceDto.userId, 
          deviceId: createInverterDeviceDto.deviceId 
        },
        deviceData,
        { new: true, upsert: true }
      )
      .exec();

    // // Emit MQTT event
    // if (createInverterDeviceDto.userId) {
    //   await this.mqttService.emitDeviceAdded(
    //     createInverterDeviceDto.userId,
    //     savedDevice,
    //   );
    // }

    return savedDevice;
  }

  async findAll(
    page: number = 1,
    limit: number = 100,
  ): Promise<{
    data: InverterDevice[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      this.inverterDeviceModel
        .find()
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.inverterDeviceModel.countDocuments().exec(),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByUserId(userId: string): Promise<InverterDevice[]> {
    return this.inverterDeviceModel.find({ userId }).lean().exec();
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterDevice | null> {
    return this.inverterDeviceModel.findOne({ userId, deviceId }).exec();
  }

  async findOne(_id: string): Promise<InverterDevice | null> {
    return this.inverterDeviceModel.findById(_id).exec();
  }

  async update(
    _id: string,
    updateInverterDeviceDto: Partial<InverterDevice>,
  ): Promise<InverterDevice | null> {
    updateInverterDeviceDto.updatedAt = new Date();
    return this.inverterDeviceModel
      .findByIdAndUpdate(_id, updateInverterDeviceDto, { new: true })
      .exec();
  }

  async updateByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    updateInverterDeviceDto: Partial<InverterDevice>,
  ): Promise<InverterDevice | null> {
    updateInverterDeviceDto.updatedAt = new Date();
    const updatedDevice = await this.inverterDeviceModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterDeviceDto, {
        new: true,
      })
      .exec();

    // // Emit MQTT event
    // if (updatedDevice) {
    //   await this.mqttService.emitDeviceUpdated(userId, updatedDevice);
    // }

    return updatedDevice;
  }

  async remove(_id: string): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel
      .findByIdAndDelete(_id)
      .exec();

    // // Emit MQTT event
    // if (deletedDevice) {
    //   await this.mqttService.emitDeviceRemoved(
    //     deletedDevice.userId,
    //     deletedDevice,
    //   );
    // }

    return deletedDevice;
  }

  async removeByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel
      .findOneAndDelete({ userId, deviceId })
      .exec();

    // // Emit MQTT event
    // if (deletedDevice) {
    //   await this.mqttService.emitDeviceRemoved(userId, deletedDevice);
    // }

    return deletedDevice;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterDeviceModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  @OnEvent('device.message.received')
  async handleDeviceMessageReceived(payload: {
    currentUid: string;
    wifiSsid: string;
    data: any;
  }) {
    try {
      // Create or update device in database
      const deviceData = {
        userId: payload.currentUid,
        deviceId: payload.wifiSsid,
        deviceName: payload.data.deviceName || payload.wifiSsid || 'Unknown Device',
        updatedAt: new Date(),
      };

      // Use upsert to create or update the device
      const device = await this.inverterDeviceModel
        .findOneAndUpdate(
          { userId: payload.currentUid, deviceId: payload.wifiSsid },
          deviceData,
          { new: true, upsert: true }
        )
        .exec();


      // Emit MQTT event for device update
      await this.mqttService.emitDeviceUpdated(payload.currentUid, device);
    } catch (error) {
      console.error(
        `Error saving device for ${payload.currentUid}/${payload.wifiSsid}:`,
        error,
      );
    }
  }
}
