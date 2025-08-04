import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InverterSchedule,
  InverterScheduleDocument,
} from '../models/inverter-schedule.schema';
import { MqttService } from './mqtt.service';

@Injectable()
export class InverterScheduleService {
  constructor(
    @InjectModel(InverterSchedule.name)
    private inverterScheduleModel: Model<InverterScheduleDocument>,
    private mqttService: MqttService,
  ) {}

  async create(
    createInverterScheduleDto: Partial<InverterSchedule>,
  ): Promise<InverterSchedule> {
    const createdInverterSchedule = new this.inverterScheduleModel(
      createInverterScheduleDto,
    );
    return createdInverterSchedule.save();
  }

  async findAll(): Promise<InverterSchedule[]> {
    return this.inverterScheduleModel.find().exec();
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<InverterSchedule | null> {
    return this.inverterScheduleModel.findOne({ userId, deviceId }).exec();
  }

  async findOne(_id: string): Promise<InverterSchedule | null> {
    return this.inverterScheduleModel.findById(_id).exec();
  }

  async update(
    _id: string,
    updateInverterScheduleDto: Partial<InverterSchedule>,
  ): Promise<InverterSchedule | null> {
    updateInverterScheduleDto.updatedAt = new Date();
    return this.inverterScheduleModel
      .findByIdAndUpdate(_id, updateInverterScheduleDto, { new: true })
      .exec();
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
    return this.inverterScheduleModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterScheduleDto, {
        new: true,
      })
      .exec();
  }

  async updateScheduleByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    schedule: string,
  ): Promise<InverterSchedule | null> {
    const updatedSchedule = await this.inverterScheduleModel
      .findOneAndUpdate(
        { userId, deviceId },
        { schedule, updatedAt: new Date() },
        { new: true, upsert: true },
      )
      .exec();

    return updatedSchedule;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterScheduleModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
}