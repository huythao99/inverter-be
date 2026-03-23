import {
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Decimal } from 'decimal.js';
import { Admin, AdminDocument } from '../models/admin.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  MqttCredential,
  MqttCredentialDocument,
} from '../models/mqtt-credential.schema';
import { DailyTotals, DailyTotalsDocument } from '../models/daily-totals.schema';
import {
  InverterData,
  InverterDataDocument,
} from '../models/inverter-data.schema';
import {
  InverterSetting,
  InverterSettingDocument,
} from '../models/inverter-setting.schema';
import {
  InverterSchedule,
  InverterScheduleDocument,
} from '../models/inverter-schedule.schema';
import {
  DeviceQueryDto,
  UserQueryDto,
  AnalyticsQueryDto,
  UpdateDeviceDto,
  UpdateUserDto,
  UpdateSettingsDto,
} from '../dto/cms-query.dto';
import { AdminLoginDto } from '../dto/admin-login.dto';

export interface DashboardStats {
  totalDevices: number;
  totalUsers: number;
  activeUsers: number;
  todayTotalA: number;
  todayTotalA2: number;
  devicesAddedToday: number;
  devicesAddedThisWeek: number;
}

export interface AnalyticsData {
  dailyTotals: Array<{
    date: string;
    totalA: number;
    totalA2: number;
    deviceCount: number;
  }>;
  deviceStats: Array<{
    deviceId: string;
    deviceName: string;
    userId: string;
    totalA: number;
    totalA2: number;
    lastUpdated: Date;
  }>;
  summary: {
    totalA: number;
    totalA2: number;
    uniqueDevices: number;
    uniqueUsers: number;
    averageDailyA: number;
    averageDailyA2: number;
  };
}

@Injectable()
export class CmsService implements OnModuleInit {
  private readonly logger = new Logger(CmsService.name);
  private readonly defaultAdminUsername: string;
  private readonly defaultAdminPassword: string;

  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    @InjectModel(MqttCredential.name)
    private mqttCredentialModel: Model<MqttCredentialDocument>,
    @InjectModel(DailyTotals.name)
    private dailyTotalsModel: Model<DailyTotalsDocument>,
    @InjectModel(InverterData.name)
    private inverterDataModel: Model<InverterDataDocument>,
    @InjectModel(InverterSetting.name)
    private inverterSettingModel: Model<InverterSettingDocument>,
    @InjectModel(InverterSchedule.name)
    private inverterScheduleModel: Model<InverterScheduleDocument>,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {
    this.defaultAdminUsername = this.configService.get<string>(
      'CMS_ADMIN_USERNAME',
      'admin',
    );
    this.defaultAdminPassword = this.configService.get<string>(
      'CMS_ADMIN_PASSWORD',
      'admin123',
    );
  }

  async onModuleInit() {
    await this.ensureDefaultAdminExists();
  }

  private async ensureDefaultAdminExists(): Promise<void> {
    const existingAdmin = await this.adminModel
      .findOne({ username: this.defaultAdminUsername })
      .exec();

    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash(this.defaultAdminPassword, 10);
      await this.adminModel.create({
        username: this.defaultAdminUsername,
        passwordHash,
        role: 'super_admin',
        isActive: true,
      });
      this.logger.log(
        `Default admin user created: ${this.defaultAdminUsername}`,
      );
    }
  }

  // ==================== Authentication ====================

  async login(
    loginDto: AdminLoginDto,
  ): Promise<{ accessToken: string; admin: Partial<Admin> }> {
    const { username, password } = loginDto;

    const admin = await this.adminModel.findOne({ username, isActive: true }).exec();

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    admin.lastLoginAt = new Date();
    admin.updatedAt = new Date();
    await admin.save();

    const payload = {
      sub: admin._id.toString(),
      username: admin.username,
      role: admin.role,
    };

    // expiresIn is already configured in module, use default sign
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      admin: {
        username: admin.username,
        role: admin.role,
        lastLoginAt: admin.lastLoginAt,
      },
    };
  }

  async getProfile(admin: AdminDocument): Promise<Partial<Admin>> {
    return {
      username: admin.username,
      role: admin.role,
      isActive: admin.isActive,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    };
  }

  // ==================== Dashboard ====================

  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = this.getGMT7DateStart(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      totalDevices,
      totalUsers,
      activeUsers,
      todayTotals,
      devicesAddedToday,
      devicesAddedThisWeek,
    ] = await Promise.all([
      this.inverterDeviceModel.countDocuments().exec(),
      this.mqttCredentialModel.countDocuments().exec(),
      this.mqttCredentialModel.countDocuments({ isActive: true }).exec(),
      this.dailyTotalsModel
        .aggregate([
          {
            $match: {
              date: { $gte: todayStart },
              deletedAt: null,
            },
          },
          {
            $group: {
              _id: null,
              totalA: { $sum: '$totalA' },
              totalA2: { $sum: '$totalA2' },
            },
          },
        ])
        .exec(),
      this.inverterDeviceModel
        .countDocuments({
          createdAt: { $gte: todayStart },
        })
        .exec(),
      this.inverterDeviceModel
        .countDocuments({
          createdAt: { $gte: weekStart },
        })
        .exec(),
    ]);

    const todayData = todayTotals[0] || { totalA: 0, totalA2: 0 };

    return {
      totalDevices,
      totalUsers,
      activeUsers,
      todayTotalA: todayData.totalA,
      todayTotalA2: todayData.totalA2,
      devicesAddedToday,
      devicesAddedThisWeek,
    };
  }

  async getAnalytics(query: AnalyticsQueryDto): Promise<AnalyticsData> {
    const { startDate, endDate, userId, deviceId } = query;

    const match: any = { deletedAt: null };

    if (startDate || endDate) {
      match.date = {};
      if (startDate) {
        match.date.$gte = this.getGMT7DateStart(new Date(startDate));
      }
      if (endDate) {
        const end = this.getGMT7DateStart(new Date(endDate));
        end.setHours(23, 59, 59, 999);
        match.date.$lte = end;
      }
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      match.date = { $gte: this.getGMT7DateStart(thirtyDaysAgo) };
    }

    if (userId) match.userId = userId;
    if (deviceId) match.deviceId = deviceId;

    const [dailyAggregation, deviceAggregation] = await Promise.all([
      this.dailyTotalsModel
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              totalA: { $sum: '$totalA' },
              totalA2: { $sum: '$totalA2' },
              deviceCount: { $addToSet: '$deviceId' },
            },
          },
          {
            $project: {
              date: '$_id',
              totalA: 1,
              totalA2: 1,
              deviceCount: { $size: '$deviceCount' },
            },
          },
          { $sort: { date: 1 } },
        ])
        .exec(),
      this.dailyTotalsModel
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: { deviceId: '$deviceId', userId: '$userId' },
              totalA: { $sum: '$totalA' },
              totalA2: { $sum: '$totalA2' },
              lastUpdated: { $max: '$updatedAt' },
            },
          },
          {
            $lookup: {
              from: 'inverterdevices',
              let: { deviceId: '$_id.deviceId', userId: '$_id.userId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$deviceId', '$$deviceId'] },
                        { $eq: ['$userId', '$$userId'] },
                      ],
                    },
                  },
                },
              ],
              as: 'device',
            },
          },
          {
            $project: {
              deviceId: '$_id.deviceId',
              userId: '$_id.userId',
              totalA: 1,
              totalA2: 1,
              lastUpdated: 1,
              deviceName: { $arrayElemAt: ['$device.deviceName', 0] },
            },
          },
          { $sort: { totalA: -1 } },
          { $limit: 100 },
        ])
        .exec(),
    ]);

    const dailyTotals = dailyAggregation.map((d: any) => ({
      date: d.date,
      totalA: d.totalA,
      totalA2: d.totalA2,
      deviceCount: d.deviceCount,
    }));

    const deviceStats = deviceAggregation.map((d: any) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName || d.deviceId,
      userId: d.userId,
      totalA: d.totalA,
      totalA2: d.totalA2,
      lastUpdated: d.lastUpdated,
    }));

    // Calculate summary
    const totalA = dailyTotals.reduce(
      (sum, d) => new Decimal(sum).plus(d.totalA).toNumber(),
      0,
    );
    const totalA2 = dailyTotals.reduce(
      (sum, d) => new Decimal(sum).plus(d.totalA2).toNumber(),
      0,
    );
    const uniqueDevices = new Set(deviceStats.map((d) => d.deviceId)).size;
    const uniqueUsers = new Set(deviceStats.map((d) => d.userId)).size;
    const daysCount = dailyTotals.length || 1;

    return {
      dailyTotals,
      deviceStats,
      summary: {
        totalA,
        totalA2,
        uniqueDevices,
        uniqueUsers,
        averageDailyA: totalA / daysCount,
        averageDailyA2: totalA2 / daysCount,
      },
    };
  }

  // ==================== Device Management ====================

  async getDevices(query: DeviceQueryDto): Promise<{
    data: InverterDevice[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20, userId, deviceId, search } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
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
      this.inverterDeviceModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.inverterDeviceModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDeviceById(id: string): Promise<InverterDevice> {
    const device = await this.inverterDeviceModel.findById(id).exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return device;
  }

  async updateDevice(
    id: string,
    updateDto: UpdateDeviceDto,
  ): Promise<InverterDevice> {
    const device = await this.inverterDeviceModel
      .findByIdAndUpdate(
        id,
        { ...updateDto, updatedAt: new Date() },
        { new: true },
      )
      .exec();

    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }

    return device;
  }

  async deleteDevice(id: string): Promise<{ message: string }> {
    const device = await this.inverterDeviceModel.findByIdAndDelete(id).exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return { message: `Device ${device.deviceId} deleted successfully` };
  }

  async getDeviceDetails(
    userId: string,
    deviceId: string,
  ): Promise<{
    device: InverterDevice | null;
    data: any;
    settings: any;
    schedule: any;
    dailyTotals: DailyTotals[];
  }> {
    const [device, data, settings, schedule, dailyTotals] = await Promise.all([
      this.inverterDeviceModel.findOne({ userId, deviceId }).lean().exec(),
      this.inverterDataModel.findOne({ userId, deviceId }).lean().exec(),
      this.inverterSettingModel.findOne({ userId, deviceId }).lean().exec(),
      this.inverterScheduleModel.findOne({ userId, deviceId }).lean().exec(),
      this.dailyTotalsModel
        .find({ userId, deviceId, deletedAt: null })
        .sort({ date: -1 })
        .limit(30)
        .lean()
        .exec(),
    ]);

    // Parse JSON values
    let parsedData: any = null;
    let parsedSettings: any = null;
    let parsedSchedule: any = null;

    if (data?.value) {
      try {
        parsedData = {
          ...data,
          parsedValue: JSON.parse(data.value),
        };
      } catch {
        parsedData = data;
      }
    }

    if (settings?.value) {
      try {
        parsedSettings = {
          ...settings,
          parsedValue: JSON.parse(settings.value),
        };
      } catch {
        parsedSettings = settings;
      }
    }

    if (schedule?.schedule) {
      try {
        parsedSchedule = {
          ...schedule,
          parsedSchedule: JSON.parse(schedule.schedule),
        };
      } catch {
        parsedSchedule = schedule;
      }
    }

    return {
      device,
      data: parsedData,
      settings: parsedSettings,
      schedule: parsedSchedule,
      dailyTotals,
    };
  }

  // ==================== User Management ====================

  async getUsers(query: UserQueryDto): Promise<{
    data: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20, userId, search, isActive } = query;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (userId) filter.userId = userId;
    if (isActive !== undefined) filter.isActive = isActive;
    if (search) {
      filter.$or = [
        { userId: { $regex: search, $options: 'i' } },
        { mqttUsername: { $regex: search, $options: 'i' } },
      ];
    }

    const [credentials, total] = await Promise.all([
      this.mqttCredentialModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.mqttCredentialModel.countDocuments(filter).exec(),
    ]);

    // Enrich with device count
    const userIds = credentials.map((c) => c.userId);
    const deviceCounts = await this.inverterDeviceModel
      .aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      .exec();

    const deviceCountMap = new Map(
      deviceCounts.map((d: any) => [d._id, d.count]),
    );

    const data = credentials.map((cred) => ({
      ...cred,
      deviceCount: deviceCountMap.get(cred.userId) || 0,
    }));

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(userId: string): Promise<any> {
    const credential = await this.mqttCredentialModel
      .findOne({ userId })
      .lean()
      .exec();

    if (!credential) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const devices = await this.inverterDeviceModel
      .find({ userId })
      .lean()
      .exec();

    return {
      ...credential,
      devices,
    };
  }

  async updateUser(userId: string, updateDto: UpdateUserDto): Promise<any> {
    const updateData: any = { updatedAt: new Date() };

    if (updateDto.isActive !== undefined) {
      updateData.isActive = updateDto.isActive;
    }
    if (updateDto.allowedDevices) {
      updateData.allowedDevices = updateDto.allowedDevices;
    }

    const credential = await this.mqttCredentialModel
      .findOneAndUpdate({ userId }, updateData, { new: true })
      .exec();

    if (!credential) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return credential;
  }

  async deleteUser(userId: string): Promise<{ message: string }> {
    // Delete credential
    const credential = await this.mqttCredentialModel
      .findOneAndDelete({ userId })
      .exec();

    if (!credential) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Also delete user's devices
    await this.inverterDeviceModel.deleteMany({ userId }).exec();

    // Soft delete daily totals
    await this.dailyTotalsModel
      .updateMany({ userId }, { deletedAt: new Date() })
      .exec();

    return {
      message: `User ${userId} and all associated data deleted successfully`,
    };
  }

  // ==================== Settings ====================

  async getSettings(): Promise<any> {
    return {
      mqtt: {
        brokerHost: this.configService.get<string>(
          'MQTT_BROKER_HOST',
          'giabao-inverter.com',
        ),
        brokerPort: this.configService.get<number>('MQTT_BROKER_PORT', 1883),
        haStatePrefix: this.configService.get<string>(
          'HA_STATE_PREFIX',
          'inverter_ha',
        ),
      },
      cms: {
        jwtExpiresIn: this.configService.get<string>('CMS_JWT_EXPIRES_IN', '24h'),
      },
    };
  }

  async getMqttConfig(): Promise<any> {
    const superusers = this.configService
      .get<string>('MQTT_SUPERUSERS', 'giabao')
      .split(',')
      .map((u) => u.trim());

    return {
      broker: {
        host: this.configService.get<string>(
          'MQTT_BROKER_HOST',
          'giabao-inverter.com',
        ),
        port: this.configService.get<number>('MQTT_BROKER_PORT', 1883),
      },
      topics: {
        statePrefix: this.configService.get<string>(
          'HA_STATE_PREFIX',
          'inverter_ha',
        ),
        discoveryPrefix: 'homeassistant',
      },
      superusers,
      totalCredentials: await this.mqttCredentialModel
        .countDocuments({ isActive: true })
        .exec(),
    };
  }

  // ==================== Helpers ====================

  private getGMT7DateStart(date: Date): Date {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);
    gmt7.setHours(0, 0, 0, 0);
    return gmt7;
  }
}
