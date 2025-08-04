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
    const createdInverterDevice = new this.inverterDeviceModel(
      createInverterDeviceDto,
    );
    const savedDevice = await createdInverterDevice.save();

    // Emit MQTT event
    if (createInverterDeviceDto.userId) {
      await this.mqttService.emitDeviceAdded(
        createInverterDeviceDto.userId,
        savedDevice,
      );
    }

    return savedDevice;
  }

  async findAll(): Promise<InverterDevice[]> {
    return this.inverterDeviceModel.find().exec();
  }

  async findByUserId(userId: string): Promise<InverterDevice[]> {
    return this.inverterDeviceModel.find({ userId }).exec();
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

    // Emit MQTT event
    if (updatedDevice) {
      await this.mqttService.emitDeviceUpdated(userId, updatedDevice);
    }

    return updatedDevice;
  }

  async remove(_id: string): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel
      .findByIdAndDelete(_id)
      .exec();

    // Emit MQTT event
    if (deletedDevice) {
      await this.mqttService.emitDeviceRemoved(
        deletedDevice.userId,
        deletedDevice,
      );
    }

    return deletedDevice;
  }

  async removeByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel
      .findOneAndDelete({ userId, deviceId })
      .exec();

    // Emit MQTT event
    if (deletedDevice) {
      await this.mqttService.emitDeviceRemoved(userId, deletedDevice);
    }

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

      console.log(
        `Device saved/updated for ${payload.currentUid}/${payload.wifiSsid}:`,
        device,
      );

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
