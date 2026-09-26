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
import {
  DailyTotals,
  DailyTotalsDocument,
} from '../models/daily-totals.schema';
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
import { DailyTotalsService } from './daily-totals.service';
import {
  DeviceQueryDto,
  UserQueryDto,
  AnalyticsQueryDto,
  UpdateDeviceDto,
  UpdateUserDto,
  UpdateSettingsDto,
} from '../dto/cms-query.dto';
import { AdminLoginDto } from '../dto/admin-login.dto';
import { MqttService } from './mqtt.service';

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
    private mqttService: MqttService,
    private dailyTotalsService: DailyTotalsService,
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

    const admin = await this.adminModel
      .findOne({ username, isActive: true })
      .exec();

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
      todayValues,
      devicesAddedToday,
      devicesAddedThisWeek,
    ] = await Promise.all([
      this.inverterDeviceModel.countDocuments().exec(),
      this.mqttCredentialModel.countDocuments().exec(),
      this.mqttCredentialModel.countDocuments({ isActive: true }).exec(),
      // Convert to real daily values (autoCalculate deltas applied) before
      // summing — raw counters must never be summed.
      this.dailyTotalsService.getDailyValuesForRange({ start: todayStart }),
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

    const todayTotalA = todayValues.reduce((sum, v) => sum + v.totalA, 0);
    const todayTotalA2 = todayValues.reduce((sum, v) => sum + v.totalA2, 0);

    return {
      totalDevices,
      totalUsers,
      activeUsers,
      todayTotalA,
      todayTotalA2,
      devicesAddedToday,
      devicesAddedThisWeek,
    };
  }

  async getAnalytics(query: AnalyticsQueryDto): Promise<AnalyticsData> {
    const { startDate, endDate, userId, deviceId } = query;

    let start: Date | undefined;
    let end: Date | undefined;

    if (startDate || endDate) {
      if (startDate) start = this.getGMT7DateStart(new Date(startDate));
      if (endDate) {
        end = this.getGMT7DateStart(new Date(endDate));
        end.setHours(23, 59, 59, 999);
      }
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      start = this.getGMT7DateStart(thirtyDaysAgo);
    }

    // Real daily values with autoCalculate deltas applied (never raw counters).
    const values = await this.dailyTotalsService.getDailyValuesForRange({
      userId,
      deviceId,
      start,
      end,
    });

    // GMT+7 calendar-day label for a stored day-start instant.
    const dayLabel = (d: Date): string =>
      new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);

    // Group by day for the daily chart.
    const dailyMap = new Map<
      string,
      { totalA: Decimal; totalA2: Decimal; devices: Set<string> }
    >();
    // Group by device for the per-device leaderboard.
    const deviceMap = new Map<
      string,
      {
        deviceId: string;
        userId: string;
        totalA: Decimal;
        totalA2: Decimal;
        lastUpdated: Date;
      }
    >();

    for (const v of values) {
      const label = dayLabel(v.date);
      const deviceKey = `${v.userId}:${v.deviceId}`;

      const day = dailyMap.get(label);
      if (day) {
        day.totalA = day.totalA.plus(v.totalA);
        day.totalA2 = day.totalA2.plus(v.totalA2);
        day.devices.add(deviceKey);
      } else {
        dailyMap.set(label, {
          totalA: new Decimal(v.totalA),
          totalA2: new Decimal(v.totalA2),
          devices: new Set([deviceKey]),
        });
      }

      const dev = deviceMap.get(deviceKey);
      if (dev) {
        dev.totalA = dev.totalA.plus(v.totalA);
        dev.totalA2 = dev.totalA2.plus(v.totalA2);
        if (v.updatedAt > dev.lastUpdated) dev.lastUpdated = v.updatedAt;
      } else {
        deviceMap.set(deviceKey, {
          deviceId: v.deviceId,
          userId: v.userId,
          totalA: new Decimal(v.totalA),
          totalA2: new Decimal(v.totalA2),
          lastUpdated: v.updatedAt,
        });
      }
    }

    const dailyTotals = [...dailyMap.entries()]
      .map(([date, d]) => ({
        date,
        totalA: d.totalA.toNumber(),
        totalA2: d.totalA2.toNumber(),
        deviceCount: d.devices.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top 100 devices by totalA.
    const topDevices = [...deviceMap.values()]
      .sort((a, b) => b.totalA.comparedTo(a.totalA))
      .slice(0, 100);

    // Resolve device names in one query.
    const nameMap = new Map<string, string>();
    if (topDevices.length > 0) {
      const nameDocs = await this.inverterDeviceModel
        .find(
          { deviceId: { $in: topDevices.map((d) => d.deviceId) } },
          { userId: 1, deviceId: 1, deviceName: 1 },
        )
        .lean()
        .exec();
      for (const doc of nameDocs) {
        nameMap.set(`${doc.userId}:${doc.deviceId}`, doc.deviceName);
      }
    }

    const deviceStats = topDevices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: nameMap.get(`${d.userId}:${d.deviceId}`) || d.deviceId,
      userId: d.userId,
      totalA: d.totalA.toNumber(),
      totalA2: d.totalA2.toNumber(),
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

  // ==================== Firmware Update ====================

  /**
   * UART diagnostics: ask the ESP32 to stream every raw STM32 line on
   * inverter/{uid}/{id}/debug/uart for `minutes` (0 = stop). Needs ESP32
   * firmware with cmd/uart-debug; older firmware ignores the command. The
   * CMS reads the lines itself over MQTT (cms_viewer can read inverter/#).
   */
  async setUartDebug(
    id: string,
    minutes: number,
  ): Promise<{ topic: string; debugTopic: string; minutes: number }> {
    const device = await this.inverterDeviceModel.findById(id).exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    const base = `inverter/${device.userId}/${device.deviceId}`;
    const topic = `${base}/cmd/uart-debug`;
    // ts: the firmware ignores a command older than 2 min (redelivery).
    await this.mqttService.publish(topic, { minutes, ts: Date.now() });
    return { topic, debugTopic: `${base}/debug/uart`, minutes };
  }

  async triggerFirmwareUpdate(
    id: string,
    targetVersion: string,
  ): Promise<{
    message: string;
    topic: string;
    userId: string;
    deviceId: string;
    statusTopic: string;
    targetVersion: string;
  }> {
    const device = await this.inverterDeviceModel.findById(id).exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }

    const topic = `inverter/${device.userId}/${device.deviceId}/firmware/update`;
    const statusTopic = `inverter/${device.userId}/${device.deviceId}/ota/status`;
    // Only { ts }: the ESP32 reacts to the topic and uses ts to ignore a stale
    // command. Keep it short - PubSubClient (256 B buffer on old firmware)
    // silently drops a longer packet. targetVersion is only returned to the CMS.
    const payload = { ts: Date.now() };

    await this.mqttService.publish(topic, payload);

    return {
      message: `Firmware update triggered for device ${device.deviceId}`,
      topic,
      userId: device.userId,
      deviceId: device.deviceId,
      statusTopic,
      targetVersion,
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

    // Users = distinct userIds of the inverter devices. MQTT credentials only
    // exist for users who opened the Home Assistant page, so listing/searching
    // the credential collection (as before) missed almost every user.
    const and: Record<string, unknown>[] = [{ userId: { $nin: [null, ''] } }];
    if (userId?.trim()) and.push({ userId: userId.trim() });

    const term = search?.trim();
    if (term) {
      const re = { $regex: this.escapeRegex(term), $options: 'i' };
      // Also match by MQTT username (maps to the owning userId).
      const byMqtt = await this.mqttCredentialModel
        .find({ mqttUsername: re }, { userId: 1 })
        .lean()
        .exec();
      and.push({
        $or: [
          { userId: re },
          ...(byMqtt.length
            ? [{ userId: { $in: byMqtt.map((c) => c.userId) } }]
            : []),
        ],
      });
    }
    if (isActive !== undefined) {
      const creds = await this.mqttCredentialModel
        .find({ isActive }, { userId: 1 })
        .lean()
        .exec();
      and.push({ userId: { $in: creds.map((c) => c.userId) } });
    }

    const [res] = await this.inverterDeviceModel
      .aggregate<{
        data: {
          _id: string;
          deviceCount: number;
          lastDeviceUpdate?: Date;
          firstSeen?: Date;
        }[];
        total: { n: number }[];
      }>([
        { $match: { $and: and } },
        {
          $group: {
            _id: '$userId',
            deviceCount: { $sum: 1 },
            lastDeviceUpdate: { $max: '$updatedAt' },
            firstSeen: { $min: '$createdAt' },
          },
        },
        { $sort: { lastDeviceUpdate: -1, _id: 1 } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .exec();

    const rows = res?.data ?? [];
    const total = res?.total?.[0]?.n ?? 0;

    const credentials = await this.mqttCredentialModel
      .find({ userId: { $in: rows.map((r) => r._id) } })
      .lean()
      .exec();
    const credByUser = new Map(credentials.map((c) => [c.userId, c]));

    const data = rows.map((r) => {
      const cred = credByUser.get(r._id);
      return {
        _id: r._id,
        userId: r._id,
        deviceCount: r.deviceCount,
        lastDeviceUpdate: r.lastDeviceUpdate ?? null,
        hasMqttAccount: !!cred,
        mqttUsername: cred?.mqttUsername ?? null,
        isActive: cred?.isActive ?? null,
        lastUsedAt: cred?.lastUsedAt ?? null,
        createdAt: cred?.createdAt ?? r.firstSeen ?? null,
      };
    });

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async getUserById(userId: string): Promise<any> {
    const [credential, devices] = await Promise.all([
      this.mqttCredentialModel.findOne({ userId }).lean().exec(),
      this.inverterDeviceModel.find({ userId }).lean().exec(),
    ]);

    // A user exists if they own a device or have MQTT credentials.
    if (!credential && devices.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return {
      _id: credential?._id ?? userId,
      userId,
      hasMqttAccount: !!credential,
      mqttUsername: credential?.mqttUsername ?? null,
      isActive: credential?.isActive ?? null,
      lastUsedAt: credential?.lastUsedAt ?? null,
      createdAt: credential?.createdAt ?? null,
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

    // Also delete user's devices (users without MQTT credentials are listed
    // from their devices, so they must be deletable too).
    const removed = await this.inverterDeviceModel
      .deleteMany({ userId })
      .exec();

    if (!credential && removed.deletedCount === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

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
        jwtExpiresIn: this.configService.get<string>(
          'CMS_JWT_EXPIRES_IN',
          '24h',
        ),
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
