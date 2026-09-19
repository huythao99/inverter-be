import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';

@Injectable()
export class ChargerDeviceService {
  constructor(
    @InjectModel(ChargerDevice.name)
    private chargerDeviceModel: Model<ChargerDeviceDocument>,
  ) {}

  async create(
    createChargerDeviceDto: Partial<ChargerDevice>,
  ): Promise<ChargerDevice> {
    const deviceData = {
      ...createChargerDeviceDto,
      updatedAt: new Date(),
    };
    return this.chargerDeviceModel
      .findOneAndUpdate(
        {
          userId: createChargerDeviceDto.userId,
          deviceId: createChargerDeviceDto.deviceId,
        },
        deviceData,
        { new: true, upsert: true },
      )
      .exec();
  }

  async findAll(
    page: number = 1,
    limit: number = 100,
  ): Promise<{
    data: ChargerDevice[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.chargerDeviceModel
        .find()
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.chargerDeviceModel.countDocuments().exec(),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findByUserId(userId: string): Promise<ChargerDevice[]> {
    return this.chargerDeviceModel.find({ userId }).lean().exec();
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel.findOne({ userId, deviceId }).exec();
  }

  async findOne(_id: string): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel.findById(_id).exec();
  }

  async update(
    _id: string,
    updateChargerDeviceDto: Partial<ChargerDevice>,
  ): Promise<ChargerDevice | null> {
    updateChargerDeviceDto.updatedAt = new Date();
    return this.chargerDeviceModel
      .findByIdAndUpdate(_id, updateChargerDeviceDto, { new: true })
      .exec();
  }

  async updateByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    updateChargerDeviceDto: Partial<ChargerDevice>,
  ): Promise<ChargerDevice | null> {
    updateChargerDeviceDto.updatedAt = new Date();
    return this.chargerDeviceModel
      .findOneAndUpdate({ userId, deviceId }, updateChargerDeviceDto, {
        new: true,
      })
      .exec();
  }

  async remove(_id: string): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel.findByIdAndDelete(_id).exec();
  }

  async removeByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel
      .findOneAndDelete({ userId, deviceId })
      .exec();
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.chargerDeviceModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  async updateFirmwareVersion(
    userId: string,
    deviceId: string,
    firmwareVersion: string,
  ): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel
      .findOneAndUpdate(
        { userId, deviceId },
        { firmwareVersion, updatedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  async updateDescription(
    userId: string,
    deviceId: string,
    description: string,
  ): Promise<ChargerDevice | null> {
    return this.chargerDeviceModel
      .findOneAndUpdate(
        { userId, deviceId },
        { description, updatedAt: new Date() },
        { new: true },
      )
      .exec();
  }
}
