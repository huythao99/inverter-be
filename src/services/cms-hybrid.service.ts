import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  HybridDevice,
  HybridDeviceDocument,
} from '../models/hybrid-device.schema';
import { HybridData, HybridDataDocument } from '../models/hybrid-data.schema';
import { DeviceQueryDto, UpdateDeviceDto } from '../dto/cms-query.dto';
import { UserEmailService } from './user-email.service';
import { HybridDeviceService } from './hybrid-device.service';
import { HybridDataService } from './hybrid-data.service';
import {
  HybridSettingService,
  hybridOpenRequest,
} from './hybrid-setting.service';
import { HybridFirmwareService } from './hybrid-firmware.service';
import { hybridPendingKeys, vnDay } from '../constants/hybrid.constants';

// Online = a message within this window (same as the user API).
const ONLINE_WINDOW_MS = 15000;

/** Short state of a hybrid for the CMS list (from the last $TLM / $CFG). */
export interface HybridSummary {
  online: boolean;
  lastSeenAt: Date | null;
  st: string | null; // RUN IDLE OFF STOP FLT
  mode: string | null; // OFF OFFGRID LOAD CHG EXPORT
  flt: string | null; // 0 = no fault
  lock: boolean;
  src: string | null; // LOCAL | ESP
  vbat: string | null;
  stmFw: string | null; // $INFO FW
}

export type CmsHybridStatus = 'online' | 'offline' | 'fault' | 'local';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Admin (CMS) view of hybrid devices: list / search, details, delete, OTA. */
@Injectable()
export class CmsHybridService {
  constructor(
    @InjectModel(HybridDevice.name)
    private readonly deviceModel: Model<HybridDeviceDocument>,
    @InjectModel(HybridData.name)
    private readonly dataModel: Model<HybridDataDocument>,
    private readonly devices: HybridDeviceService,
    private readonly data: HybridDataService,
    private readonly settings: HybridSettingService,
    private readonly firmware: HybridFirmwareService,
    private readonly userEmailService: UserEmailService,
  ) {}

  private static summary(
    d: Partial<HybridData> | null | undefined,
  ): HybridSummary {
    const lastSeen = d?.lastSeenAt ? new Date(d.lastSeenAt) : null;
    const t = d?.tlm ?? {};
    return {
      online: !!lastSeen && Date.now() - lastSeen.getTime() < ONLINE_WINDOW_MS,
      lastSeenAt: lastSeen,
      st: t.ST ?? null,
      mode: t.MODE ?? d?.cfg?.MODE ?? null,
      flt: t.FLT ?? null,
      lock: t.LOCK === '1',
      src: t.SRC ?? d?.cfg?.SRC ?? null,
      vbat: t.VBAT ?? null,
      stmFw: d?.info?.FW ?? null,
    };
  }

  async getDashboard() {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const onlineSince = new Date(now - ONLINE_WINDOW_MS);
    const [total, online, fault, local, addedToday, addedThisWeek] =
      await Promise.all([
        this.deviceModel.countDocuments().exec(),
        this.dataModel
          .countDocuments({ lastSeenAt: { $gte: onlineSince } })
          .exec(),
        this.dataModel
          .countDocuments({
            lastSeenAt: { $gte: onlineSince },
            'tlm.FLT': { $exists: true, $nin: ['0', ''] },
          })
          .exec(),
        this.dataModel
          .countDocuments({
            lastSeenAt: { $gte: onlineSince },
            'tlm.SRC': 'LOCAL',
          })
          .exec(),
        this.deviceModel
          .countDocuments({ createdAt: { $gte: startOfToday } })
          .exec(),
        this.deviceModel
          .countDocuments({
            createdAt: { $gte: new Date(now - 7 * 86400_000) },
          })
          .exec(),
      ]);
    return {
      totalDevices: total,
      onlineDevices: online,
      offlineDevices: Math.max(0, total - online),
      faultDevices: fault,
      localSourceDevices: local,
      devicesAddedToday: addedToday,
      devicesAddedThisWeek: addedThisWeek,
    };
  }

  /**
   * List + search. `search` matches deviceId (HybridControl<N>), name,
   * userId or the owner's email. `status`: online | offline | fault (online
   * with FLT != 0) | local (online with SRC=LOCAL).
   */
  async getDevices(query: DeviceQueryDto & { status?: string }) {
    const { page = 1, limit = 20, userId, deviceId, search, status } = query;

    const filter: FilterQuery<HybridDeviceDocument> = {};
    if (userId) filter.userId = userId;
    if (deviceId) filter.deviceId = deviceId;
    const s = (search ?? '').trim();
    if (s) {
      const re = { $regex: escapeRegex(s), $options: 'i' };
      const or: FilterQuery<HybridDeviceDocument>[] = [
        { deviceId: re },
        { deviceName: re },
        { description: re },
        { userId: re },
      ];
      const uid = await this.userEmailService.uidForSearch(s);
      if (uid) or.push({ userId: uid });
      filter.$or = or;
    }

    // Status filters are on the data collection: resolve the matching
    // (userId, deviceId) pairs first.
    if (
      status === 'online' ||
      status === 'offline' ||
      status === 'fault' ||
      status === 'local'
    ) {
      const onlineSince = new Date(Date.now() - ONLINE_WINDOW_MS);
      const dataFilter: FilterQuery<HybridDataDocument> =
        status === 'offline'
          ? { lastSeenAt: { $gte: onlineSince } } // excluded below
          : status === 'fault'
            ? {
                lastSeenAt: { $gte: onlineSince },
                'tlm.FLT': { $exists: true, $nin: ['0', ''] },
              }
            : status === 'local'
              ? { lastSeenAt: { $gte: onlineSince }, 'tlm.SRC': 'LOCAL' }
              : { lastSeenAt: { $gte: onlineSince } };
      const rows = (await this.dataModel
        .find(dataFilter)
        .select('userId deviceId')
        .lean()
        .exec()) as { userId: string; deviceId: string }[];
      const pairs = rows.map((r) => ({
        userId: r.userId,
        deviceId: r.deviceId,
      }));
      const cond =
        status === 'offline'
          ? pairs.length
            ? { $nor: pairs }
            : {}
          : pairs.length
            ? { $or: pairs }
            : { _id: null };
      filter.$and = [
        ...((filter.$and as FilterQuery<HybridDeviceDocument>[]) ?? []),
        cond,
      ];
    }

    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.deviceModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.deviceModel.countDocuments(filter).exec(),
    ]);
    const withOwners = await this.userEmailService.withOwners(
      rows as HybridDevice[],
    );
    const datas = rows.length
      ? ((await this.dataModel
          .find({
            $or: rows.map((r) => ({ userId: r.userId, deviceId: r.deviceId })),
          })
          .select('userId deviceId tlm cfg info lastSeenAt')
          .lean()
          .exec()) as HybridData[])
      : [];
    const byKey = new Map(datas.map((d) => [`${d.userId}|${d.deviceId}`, d]));
    const data = withOwners.map((r) => ({
      ...r,
      summary: CmsHybridService.summary(byKey.get(`${r.userId}|${r.deviceId}`)),
    }));
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  private async byId(id: string): Promise<HybridDevice> {
    const device = (await this.deviceModel
      .findById(id)
      .lean()
      .exec()) as HybridDevice | null;
    if (!device) throw new NotFoundException(`Hybrid with ID ${id} not found`);
    return device;
  }

  getDeviceById(id: string) {
    return this.byId(id);
  }

  /** Everything about one unit: latest frames, server config, energy (30 days). */
  async getDeviceDetails(userId: string, deviceId: string) {
    const [device, latest, setting, energy] = await Promise.all([
      this.deviceModel.findOne({ userId, deviceId }).lean().exec(),
      this.data.findLatest(userId, deviceId),
      this.settings.get(userId, deviceId),
      this.data.energy(
        userId,
        deviceId,
        vnDay(new Date(Date.now() - 29 * 86400_000)),
        vnDay(),
      ),
    ]);
    if (!device) throw new NotFoundException(`Hybrid ${deviceId} not found`);
    const [withOwner] = await this.userEmailService.withOwners([
      device as HybridDevice,
    ]);
    return {
      device: withOwner,
      summary: CmsHybridService.summary(latest),
      data: latest,
      setting: {
        ...setting,
        pending: hybridPendingKeys(
          hybridOpenRequest(setting.request, latest?.cfgAt)?.config ?? {},
          latest?.cfg,
        ),
      },
      energy,
    };
  }

  async updateDevice(id: string, dto: UpdateDeviceDto) {
    const device = await this.deviceModel
      .findByIdAndUpdate(id, { ...dto, updatedAt: new Date() }, { new: true })
      .lean()
      .exec();
    if (!device) throw new NotFoundException(`Hybrid with ID ${id} not found`);
    return device;
  }

  /** Remove from its owner, revoke the MQTT account, drop data / energy / settings. */
  async deleteDevice(id: string) {
    const device = await this.byId(id);
    await this.devices.remove(device.userId, device.deviceId);
    await Promise.all([
      this.data.removeDevice(device.userId, device.deviceId),
      this.settings.remove(device.userId, device.deviceId),
    ]);
    return { message: `Hybrid ${device.deviceId} deleted successfully` };
  }

  /** Turn the device's UART debug log on (minutes, max 30) or off (0). */
  async setRawLog(userId: string, deviceId: string, minutes: number) {
    const device = await this.deviceModel.exists({ userId, deviceId }).exec();
    if (!device) throw new NotFoundException(`Hybrid ${deviceId} not found`);
    return this.settings.rawLog(userId, deviceId, minutes);
  }

  async triggerFirmwareUpdate(id: string) {
    const device = await this.byId(id);
    const { version } = this.firmware.getNewestFirmwareVersion(device.deviceId);
    const r = await this.firmware.triggerFirmwareUpdate(
      device.userId,
      device.deviceId,
    );
    return {
      message: `Firmware update ${version} triggered for ${device.deviceId}`,
      ...r,
      userId: device.userId,
      deviceId: device.deviceId,
      targetVersion: version,
    };
  }
}
