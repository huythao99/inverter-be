import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';
import {
  ChargerData,
  ChargerDataDocument,
} from '../models/charger-data.schema';
import {
  ChargerSetting,
  ChargerSettingDocument,
} from '../models/charger-setting.schema';
import { ChargerFirmwareService } from './charger-firmware.service';
import { DeviceQueryDto, UpdateDeviceDto } from '../dto/cms-query.dto';
import { decodeChargerValue } from '../utils/charger-value.util';

// A charger is "online" if it sent a message within this window.
const ONLINE_WINDOW_MS = 15000;

@Injectable()
export class CmsChargerService {
  constructor(
    @InjectModel(ChargerDevice.name)
    private chargerDeviceModel: Model<ChargerDeviceDocument>,
    @InjectModel(ChargerData.name)
    private chargerDataModel: Model<ChargerDataDocument>,
    @InjectModel(ChargerSetting.name)
    private chargerSettingModel: Model<ChargerSettingDocument>,
    private chargerFirmwareService: ChargerFirmwareService,
  ) {}

  async getDashboard(): Promise<{
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    devicesAddedToday: number;
    devicesAddedThisWeek: number;
  }> {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const onlineSince = new Date(now - ONLINE_WINDOW_MS);

    const [
      totalDevices,
      onlineDevices,
      devicesAddedToday,
      devicesAddedThisWeek,
    ] = await Promise.all([
      this.chargerDeviceModel.countDocuments().exec(),
      this.chargerDataModel
        .countDocuments({ lastSeenAt: { $gte: onlineSince } })
        .exec(),
      this.chargerDeviceModel
        .countDocuments({ createdAt: { $gte: startOfToday } })
        .exec(),
      this.chargerDeviceModel
        .countDocuments({ createdAt: { $gte: startOfWeek } })
        .exec(),
    ]);

    return {
      totalDevices,
      onlineDevices,
      offlineDevices: Math.max(0, totalDevices - onlineDevices),
      devicesAddedToday,
      devicesAddedThisWeek,
    };
  }

  async getDevices(query: DeviceQueryDto): Promise<{
    data: ChargerDevice[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20, userId, deviceId, search } = query;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ChargerDeviceDocument> = {};
    if (userId) filter.userId = userId;
    if (deviceId) filter.deviceId = deviceId;
    if (search) {
      filter.$or = [
        { deviceId: { $regex: search, $options: 'i' } },
        { deviceName: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.chargerDeviceModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.chargerDeviceModel.countDocuments(filter).exec(),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getDeviceById(id: string): Promise<ChargerDevice> {
    const device = await this.chargerDeviceModel.findById(id).lean().exec();
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return device;
  }

  async updateDevice(
    id: string,
    updateDto: UpdateDeviceDto,
  ): Promise<ChargerDevice> {
    const device = await this.chargerDeviceModel
      .findByIdAndUpdate(
        id,
        { ...updateDto, updatedAt: new Date() },
        { new: true },
      )
      .lean()
      .exec();
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return device;
  }

  async deleteDevice(id: string): Promise<{ message: string }> {
    const device = await this.chargerDeviceModel.findByIdAndDelete(id).exec();
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return { message: `Charger ${device.deviceId} deleted successfully` };
  }

  async getDeviceDetails(
    userId: string,
    deviceId: string,
  ): Promise<{
    device: ChargerDevice | null;
    data: (ChargerData & { online: boolean }) | null;
    setting: (ChargerSetting & { vbat?: number; ibat?: number }) | null;
  }> {
    const [device, data, setting] = await Promise.all([
      this.chargerDeviceModel.findOne({ userId, deviceId }).lean().exec(),
      this.chargerDataModel.findOne({ userId, deviceId }).lean().exec(),
      this.chargerSettingModel.findOne({ userId, deviceId }).lean().exec(),
    ]);

    let dataWithStatus: (ChargerData & { online: boolean }) | null = null;
    if (data) {
      const lastSeen = data.lastSeenAt
        ? new Date(data.lastSeenAt).getTime()
        : 0;
      const online = Date.now() - lastSeen < ONLINE_WINDOW_MS;
      dataWithStatus = {
        ...data,
        online,
        status: online ? 'online' : 'offline',
      };
    }

    let settingDecoded:
      | (ChargerSetting & { vbat?: number; ibat?: number })
      | null = null;
    if (setting) {
      const decoded = decodeChargerValue(setting.value);
      settingDecoded = { ...setting, ...(decoded ?? {}) };
    }

    return { device, data: dataWithStatus, setting: settingDecoded };
  }

  async triggerFirmwareUpdate(
    id: string,
    targetVersion?: string,
  ): Promise<{
    message: string;
    topic: string;
    statusTopic: string;
    userId: string;
    deviceId: string;
  }> {
    const device = await this.chargerDeviceModel.findById(id).lean().exec();
    if (!device) {
      throw new NotFoundException(`Charger with ID ${id} not found`);
    }
    return this.chargerFirmwareService.triggerFirmwareUpdate(
      device.userId,
      device.deviceId,
      // Informational for the device; default to the build it will download.
      targetVersion ||
        this.chargerFirmwareService.getNewestFirmwareVersion(device.deviceId)
          .version,
    );
  }
}
