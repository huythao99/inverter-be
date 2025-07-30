import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InverterDevice, InverterDeviceDocument } from '../models/inverter-device.schema';
import { DeviceGateway } from '../gateways/device.gateway';

@Injectable()
export class InverterDeviceService {
  constructor(
    @InjectModel(InverterDevice.name) private inverterDeviceModel: Model<InverterDeviceDocument>,
    private deviceGateway: DeviceGateway,
  ) {}

  async create(createInverterDeviceDto: Partial<InverterDevice>): Promise<InverterDevice> {
    const createdInverterDevice = new this.inverterDeviceModel(createInverterDeviceDto);
    const savedDevice = await createdInverterDevice.save();
    
    // Emit socket event
    if (createInverterDeviceDto.userId) {
      this.deviceGateway.emitDeviceAdded(createInverterDeviceDto.userId, savedDevice);
    }
    
    return savedDevice;
  }

  async findAll(): Promise<InverterDevice[]> {
    return this.inverterDeviceModel.find().exec();
  }

  async findByUserId(userId: string): Promise<InverterDevice[]> {
    return this.inverterDeviceModel.find({ userId }).exec();
  }

  async findByUserIdAndDeviceId(userId: string, deviceId: string): Promise<InverterDevice | null> {
    return this.inverterDeviceModel.findOne({ userId, deviceId }).exec();
  }

  async findOne(_id: string): Promise<InverterDevice | null> {
    return this.inverterDeviceModel.findById(_id).exec();
  }

  async update(_id: string, updateInverterDeviceDto: Partial<InverterDevice>): Promise<InverterDevice | null> {
    updateInverterDeviceDto.updatedAt = new Date();
    return this.inverterDeviceModel
      .findByIdAndUpdate(_id, updateInverterDeviceDto, { new: true })
      .exec();
  }

  async updateByUserIdAndDeviceId(userId: string, deviceId: string, updateInverterDeviceDto: Partial<InverterDevice>): Promise<InverterDevice | null> {
    updateInverterDeviceDto.updatedAt = new Date();
    const updatedDevice = await this.inverterDeviceModel
      .findOneAndUpdate({ userId, deviceId }, updateInverterDeviceDto, { new: true })
      .exec();
    
    // Emit socket event
    if (updatedDevice) {
      this.deviceGateway.emitDeviceUpdated(userId, updatedDevice);
    }
    
    return updatedDevice;
  }

  async remove(_id: string): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel.findByIdAndDelete(_id).exec();
    
    // Emit socket event
    if (deletedDevice) {
      this.deviceGateway.emitDeviceRemoved(deletedDevice.userId, deletedDevice);
    }
    
    return deletedDevice;
  }

  async removeByUserIdAndDeviceId(userId: string, deviceId: string): Promise<InverterDevice | null> {
    const deletedDevice = await this.inverterDeviceModel.findOneAndDelete({ userId, deviceId }).exec();
    
    // Emit socket event
    if (deletedDevice) {
      this.deviceGateway.emitDeviceRemoved(userId, deletedDevice);
    }
    
    return deletedDevice;
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.inverterDeviceModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }
} 