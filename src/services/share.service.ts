import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { ShareGroup, ShareGroupDocument } from '../models/share-group.schema';
import { RedisConfig } from '../config/redis.config';
import { InverterDataService } from './inverter-data.service';
import { GridTieService } from './grid-tie.service';
import { CreateShareGroupDto } from '../dto/create-share-group.dto';
import { UpdateShareGroupDto } from '../dto/update-share-group.dto';

@Injectable()
export class ShareService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly CACHE_PREFIX = 'share:computed';
  // Short TTL: the first member to poll computes the whole group once and all
  // other members reuse it for a few seconds. Bounds Mongo reads to O(N) per
  // window instead of O(N^2), while staying far below the 30s setting cache.
  private readonly CACHE_TTL_SECONDS = 5;

  constructor(
    @InjectModel(ShareGroup.name)
    private shareGroupModel: Model<ShareGroupDocument>,
    private inverterDataService: InverterDataService,
    private gridTieService: GridTieService,
    private redisConfig: RedisConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis = this.redisConfig.createRedisClient();
    this.redis.on('error', () => {
      // Redis errors handled gracefully by recomputing from MongoDB.
    });
    await this.redis.connect().catch(() => {
      // Failed initial connect - compute falls back to the DB.
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // Ignore shutdown errors.
    }
  }

  private groupCacheKey(groupId: string): string {
    return `${this.CACHE_PREFIX}:${groupId}`;
  }

  private async invalidateGroupCache(groupId: string): Promise<void> {
    try {
      await this.redis.del(this.groupCacheKey(groupId));
    } catch {
      // Cache will expire on its own via TTL.
    }
  }

  // Parse _p (index 2) + _energy (index 4) from a raw telemetry value string.
  private parsePEnergy(value?: string | null): number {
    if (!value) return 0;
    const parts = value.split('#');
    const p = parseFloat(parts[2]);
    const energy = parseFloat(parts[4]);
    return (
      (Number.isFinite(p) ? p : 0) + (Number.isFinite(energy) ? energy : 0)
    );
  }

  // The enabled share group this device belongs to, if any.
  async findEnabledGroupForDevice(
    userId: string,
    deviceId: string,
  ): Promise<ShareGroup | null> {
    return this.shareGroupModel
      .findOne({ userId, enabled: true, 'members.deviceId': deviceId })
      .lean()
      .exec();
  }

  /**
   * Computed share value for a device, or null when no override applies.
   * Backed by a per-group read-through Redis cache (see getGroupComputedValues).
   */
  async computeValue(userId: string, deviceId: string): Promise<number | null> {
    const group = await this.findEnabledGroupForDevice(userId, deviceId);
    if (!group) return null;

    const values = await this.getGroupComputedValues(userId, group);
    const value = values[deviceId];
    return value === undefined ? null : value;
  }

  /**
   * Computed value for every ON member of a group, read-through cached in Redis
   * (short TTL). One member's poll computes the whole group; the rest reuse it.
   * Any Redis failure just recomputes from MongoDB.
   */
  private async getGroupComputedValues(
    userId: string,
    group: ShareGroup,
  ): Promise<Record<string, number>> {
    const key = this.groupCacheKey(String(group._id));

    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as Record<string, number>;
    } catch {
      // Redis down - recompute below.
    }

    const values = await this.computeGroupValues(userId, group);

    try {
      await this.redis.set(
        key,
        JSON.stringify(values),
        'EX',
        this.CACHE_TTL_SECONDS,
      );
    } catch {
      // Best-effort cache write; MongoDB is the source of truth.
    }

    return values;
  }

  /**
   * Single O(N) pass: build the pool + ratio denominator from ON members only
   * (grid-tie OFF excluded from BOTH), then each ON member's share.
   */
  private async computeGroupValues(
    userId: string,
    group: ShareGroup,
  ): Promise<Record<string, number>> {
    let pool = 0;
    let totalRatio = 0;
    const active: { deviceId: string; ratio: number }[] = [];

    for (const member of group.members) {
      // Exclude grid-tie OFF members entirely.
      if (await this.gridTieService.isOff(userId, member.deviceId)) continue;

      const latest =
        await this.inverterDataService.findLatestByUserIdAndDeviceId(
          userId,
          member.deviceId,
        );
      pool += this.parsePEnergy(latest?.value);
      totalRatio += member.ratio;
      active.push({ deviceId: member.deviceId, ratio: member.ratio });
    }

    const values: Record<string, number> = {};
    if (totalRatio === 0) return values;
    for (const member of active) {
      values[member.deviceId] = Math.round((pool * member.ratio) / totalRatio);
    }
    return values;
  }

  /**
   * Given the raw 8-digit setting value, return the value the ESP32 should get.
   * First 4 digits are the cap (kept as-is); the computed share is written into
   * the LAST 4 digits, capped by the first field and zero-padded.
   *   "43003000", computed 387 -> "4300" + "0387" = "43000387"
   * Returns null when share doesn't apply or the value can't be parsed.
   */
  async getHardwareSettingValue(
    userId: string,
    deviceId: string,
    settingValue: string,
  ): Promise<string | null> {
    if (!settingValue || settingValue.length < 8) return null;

    const head = settingValue.slice(0, 4);
    const threshold = parseInt(head, 10);
    if (!Number.isFinite(threshold)) return null;

    const computed = await this.computeValue(userId, deviceId);
    if (computed === null) return null;

    const capped = Math.min(computed, threshold);
    return head + String(capped).padStart(4, '0');
  }

  /**
   * Apply the share cap to a schedule string for the ESP32: for each
   * `value=HHHHLLLL` segment, keep the first 4 digits (cap) and write
   * min(computed, cap) into the last 4. Times are untouched.
   *   "...value=53001040..." , computed 387 -> "...value=53000387..."
   * Returns null when share doesn't apply.
   */
  async getHardwareScheduleValue(
    userId: string,
    deviceId: string,
    schedule: string,
  ): Promise<string | null> {
    if (!schedule) return null;

    const computed = await this.computeValue(userId, deviceId);
    if (computed === null) return null;

    return schedule.replace(
      /value=(\d{4})(\d{4})/g,
      (_match, head: string): string => {
        const threshold = parseInt(head, 10);
        const capped = Number.isFinite(threshold)
          ? Math.min(computed, threshold)
          : computed;
        return `value=${head}${String(capped).padStart(4, '0')}`;
      },
    );
  }

  // ---- CRUD (mobile) ----

  async createGroup(
    userId: string,
    dto: CreateShareGroupDto,
  ): Promise<ShareGroup> {
    const created = new this.shareGroupModel({
      userId,
      name: dto.name,
      enabled: dto.enabled ?? true,
      members: dto.members,
      updatedAt: new Date(),
    });
    return created.save();
  }

  async listGroups(userId: string): Promise<ShareGroup[]> {
    return this.shareGroupModel.find({ userId }).lean().exec();
  }

  async getGroup(userId: string, groupId: string): Promise<ShareGroup | null> {
    if (!Types.ObjectId.isValid(groupId)) return null;
    return this.shareGroupModel.findOne({ _id: groupId, userId }).lean().exec();
  }

  async updateGroup(
    userId: string,
    groupId: string,
    dto: UpdateShareGroupDto,
  ): Promise<ShareGroup | null> {
    if (!Types.ObjectId.isValid(groupId)) return null;
    const updated = await this.shareGroupModel
      .findOneAndUpdate(
        { _id: groupId, userId },
        { ...dto, updatedAt: new Date() },
        { new: true },
      )
      .lean()
      .exec();
    // Members/ratios/enabled may have changed - drop the cached computation.
    await this.invalidateGroupCache(groupId);
    return updated;
  }

  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(groupId)) return false;
    const result = await this.shareGroupModel
      .deleteOne({ _id: groupId, userId })
      .exec();
    await this.invalidateGroupCache(groupId);
    return result.deletedCount > 0;
  }

  // Config + current computed value for a single device.
  async getShareStatus(
    userId: string,
    deviceId: string,
  ): Promise<{
    enabled: boolean;
    group: ShareGroup | null;
    computed: number | null;
  }> {
    const group = await this.findEnabledGroupForDevice(userId, deviceId);
    const computed = group ? await this.computeValue(userId, deviceId) : null;
    return { enabled: !!group, group, computed };
  }
}
