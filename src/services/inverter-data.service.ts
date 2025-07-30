import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InverterData, InverterDataDocument } from '../models/inverter-data.schema';
import { SettingDataGateway } from '../gateways/setting-data.gateway';

@Injectable()
export class InverterDataService {
  constructor(
    @InjectModel(InverterData.name) private inverterDataModel: Model<InverterDataDocument>,
    private settingDataGateway: SettingDataGateway,
  ) {}

  async create(createInverterDataDto: Partial<InverterData>): Promise<InverterData> {
    const createdInverterData = new this.inverterDataModel(createInverterDataDto);
    const savedData = await createdInverterData.save();
    
    // Emit socket event
    if (createInverterDataDto.userId && createInverterDataDto.deviceId) {
      this.settingDataGateway.emitDataAdded(createInverterDataDto.userId, createInverterDataDto.deviceId, savedData);
    }
    
    return savedData;
  }

  async findAll(): Promise<InverterData[]> {
    return this.inverterDataModel.find().exec();
  }

  async findByUserIdAndDeviceId(userId: string, deviceId: string, page: number = 1, limit: number = 10): Promise<{ data: InverterData[], total: number, page: number, totalPages: number }> {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      this.inverterDataModel
        .find({ userId, deviceId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.inverterDataModel.countDocuments({ userId, deviceId }).exec()
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  async findOne(_id: string): Promise<InverterData | null> {
    return this.inverterDataModel.findById(_id).exec();
  }

  async update(_id: string, updateInverterDataDto: Partial<InverterData>): Promise<InverterData | null> {
    updateInverterDataDto.updatedAt = new Date();
    return this.inverterDataModel
      .findByIdAndUpdate(_id, updateInverterDataDto, { new: true })
      .exec();
  }

  async remove(_id: string): Promise<InverterData | null> {
    return this.inverterDataModel.findByIdAndDelete(_id).exec();
  }

  async findLatestByUserIdAndDeviceId(userId: string, deviceId: string): Promise<InverterData | null> {
    return this.inverterDataModel
      .findOne({ userId, deviceId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterDataModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
} 