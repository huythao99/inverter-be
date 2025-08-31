import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InverterSetting,
  InverterSettingDocument,
} from '../models/inverter-setting.schema';
import { MqttService } from './mqtt.service';

@Injectable()
export class InverterSettingService {
  constructor(
    @InjectModel(InverterSetting.name)
    private inverterSettingModel: Model<InverterSettingDocument>,
    private mqttService: MqttService,
  ) {}

  async create(
    createInverterSettingDto: Partial<InverterSetting>,
  ): Promise<InverterSetting> {
    const createdInverterSetting = new this.inverterSettingModel(
      createInverterSettingDto,
    );
    return createdInverterSetting.save();
  }

  async findAll(): Promise<InverterSetting[]> {
    return this.inverterSettingModel.find().exec();
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
    return this.inverterSettingModel
      .findByIdAndUpdate(_id, updateInverterSettingDto, { new: true })
      .exec();
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
    return this.inverterSettingModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterSettingDto, {
        new: true,
      })
      .exec();
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

    return updatedSetting;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterSettingModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
}
