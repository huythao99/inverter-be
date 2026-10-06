import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ShareGroup,
  ShareGroupDocument,
  ShareMember,
} from '../models/share-group.schema';
import { RedisConfig } from '../config/redis.config';
import { InverterDataService } from './inverter-data.service';
import { GridTieService } from './grid-tie.service';
import { MqttService } from './mqtt.service';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import { compareFirmwareVersions } from './firmware.service';
import { CreateShareGroupDto } from '../dto/create-share-group.dto';
import { UpdateShareGroupDto } from '../dto/update-share-group.dto';

/** A member counts only while its telemetry is newer than this. */
export const SHARE_FRESH_MS = 30_000;
/**
 * First ESP32 firmware whose share value expires (30 s) and that treats a
 * negative value as "stop sharing" (fw 1.0.8). Older firmware keeps the share
 * baked into the setting/schedule it fetches over HTTP.
 */
export const SHARE_EXPIRY_MIN_FW = '1.0.8';
/** Re-send a share only when it moved at least this much (W)... */
export const SHARE_DEADBAND_W = 30;
/** ...or to refresh the device's 30 s validity. */
export const SHARE_KEEPALIVE_MS = 10_000;
/** The power field is 4 digits encoded as watts + 1000 -> 0..8999 W. */
export const SHARE_MAX_WATTS = 8999;

/** Watts -> the 4-digit power field (watts + 1000), clamped to 1000..9999. */
export function encodeShareWatts(watts: number): number {
  const w = Math.min(SHARE_MAX_WATTS, Math.max(0, Math.round(watts || 0)));
  return w + 1000;
}

/**
 * deviceId -> key of its "same grid line" cluster: the devices of a user's
 * share groups (enabled or not; the wiring does not change when sharing is
 * switched off), joined when groups overlap. Devices in no group are absent.
 */
export function gridClustersOf(
  groups: Array<{ members: Array<{ deviceId: string }> }>,
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const g of groups) {
    const ids = (g.members ?? []).map((m) => m.deviceId).filter(Boolean);
    if (ids.length < 2) continue;
    for (const id of ids) if (!parent.has(id)) parent.set(id, id);
    for (const id of ids.slice(1)) {
      const a = find(ids[0]);
      const b = find(id);
      if (a !== b) parent.set(b, a);
    }
  }
  const out = new Map<string, string>();
  for (const id of parent.keys()) out.set(id, `grid:${find(id)}`);
  return out;
}

/** Max discharge (W) from an 8-digit setting "VVVVPPPP" (PPPP = W + 1000). */
export function decodePowerField(value?: string | null): number | null {
  if (!value || !/^\d{8}/.test(value)) return null;
  const w = parseInt(value.slice(4, 8), 10) - 1000;
  return Number.isFinite(w) ? Math.min(SHARE_MAX_WATTS, Math.max(0, w)) : null;
}

export interface ShareSlot {
  deviceId: string;
  ratio: number;
  /** Max watts this member may discharge. */
  cap: number;
}

/**
 * Split `pool` watts by ratio without giving anyone more than its cap; what a
 * capped member can't take is re-split among the others (water filling).
 */
export function allocateShare(
  pool: number,
  slots: ShareSlot[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const live = slots.filter((s) => s.ratio > 0);
  if (!live.length) return out;
  for (const s of slots) out[s.deviceId] = 0;

  let left = Math.max(0, pool);
  let open = live;
  while (left > 0.5 && open.length) {
    const total = open.reduce((sum, s) => sum + s.ratio, 0);
    let used = 0;
    const next: ShareSlot[] = [];
    for (const s of open) {
      const want = (left * s.ratio) / total;
      const room = s.cap - out[s.deviceId];
      const give = Math.min(want, room);
      out[s.deviceId] += give;
      used += give;
      if (want < room) next.push(s);
    }
    left -= used;
    if (next.length === open.length) break; // nobody capped: all handed out
    open = next;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

@Injectable()
export class ShareService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly CACHE_PREFIX = 'share:computed';
  private readonly CACHE_TTL_SECONDS = 5;

  // In-memory cache: deviceKey → ShareGroup (avoids MongoDB lookup per telemetry message)
  private membershipCache = new Map<string, ShareGroup | null>();
  /** groupId -> last realtime push (ms). */
  private lastGroupPush = new Map<string, number>();
  private readonly GROUP_PUSH_MIN_MS = 1000;
  /** "uid:deviceId" -> latest telemetry of share members (kept here: the
   *  InverterDataService map is emptied every 30 s). */
  private telemetry = new Map<string, { value: string; at: number }>();
  /** "uid:deviceId" -> last share sent (W) and when. */
  private lastSent = new Map<string, { watts: number; at: number }>();
  /** "uid:deviceId" -> reported firmware, cached 5 min. */
  private fwCache = new Map<string, { at: number; fw: string | null }>();

  constructor(
    @InjectModel(ShareGroup.name)
    private shareGroupModel: Model<ShareGroupDocument>,
    private inverterDataService: InverterDataService,
    private gridTieService: GridTieService,
    private mqttService: MqttService,
    private redisConfig: RedisConfig,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
  ) {}

  /** Make devices re-fetch setting + schedule (share applied or removed). */
  private notifyMembers(userId: string, deviceIds: string[]): void {
    for (const deviceId of new Set(deviceIds)) {
      void this.mqttService.emitSyncSettings(userId, deviceId);
      void this.mqttService.emitSyncSchedule(userId, deviceId);
    }
  }

  private membershipCacheKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private clearMembershipCache(): void {
    this.membershipCache.clear();
  }

  private async findEnabledGroupCached(
    userId: string,
    deviceId: string,
  ): Promise<ShareGroup | null> {
    const key = this.membershipCacheKey(userId, deviceId);
    if (this.membershipCache.has(key)) {
      return this.membershipCache.get(key) ?? null;
    }
    const group = await this.findEnabledGroupForDevice(userId, deviceId);
    this.membershipCache.set(key, group);
    return group;
  }

  @OnEvent('inverter.data.received')
  async handleTelemetryForShare(payload: {
    currentUid: string;
    wifiSsid: string;
    data: { value?: string };
  }): Promise<void> {
    const userId = payload.currentUid;
    const deviceId = payload.wifiSsid;
    const currentValue = payload.data?.value;
    if (!currentValue) return;

    const group = await this.findEnabledGroupCached(userId, deviceId);
    if (!group) return;

    const key = this.membershipCacheKey(userId, deviceId);
    this.telemetry.set(key, { value: currentValue, at: Date.now() });
    if (this.telemetry.size > 5000) this.telemetry.clear();

    // Every member's frame used to recompute + republish the whole group
    // (N members -> N pushes per member per frame). Once per second is enough:
    // the ESP32 keeps a share value for 30 s.
    const gid = String(group._id);
    const now = Date.now();
    if (now - (this.lastGroupPush.get(gid) ?? 0) < this.GROUP_PUSH_MIN_MS) {
      return;
    }
    this.lastGroupPush.set(gid, now);
    if (this.lastGroupPush.size > 5000) this.lastGroupPush.clear();

    const computed = await this.computeGroup(userId, group, {
      deviceId,
      value: currentValue,
    });

    for (const [memberId, watts] of Object.entries(computed)) {
      // Small moves (< 30 W) are not sent: they only make the ESP32 rewrite
      // the STM32. The value is still re-sent every 10 s so the device's 30 s
      // share validity never runs out while the load is steady.
      const mk = this.membershipCacheKey(userId, memberId);
      const prev = this.lastSent.get(mk);
      if (
        prev &&
        Math.abs(watts - prev.watts) < SHARE_DEADBAND_W &&
        now - prev.at < SHARE_KEEPALIVE_MS
      ) {
        continue;
      }
      this.lastSent.set(mk, { watts, at: now });
      if (this.lastSent.size > 5000) this.lastSent.clear();
      // The ESP32 forwards the number as-is into the power field of the STM32
      // command, which (like every setting) is encoded as watts + 1000.
      void this.mqttService.emitShareValue(
        userId,
        memberId,
        encodeShareWatts(watts),
      );
    }
  }

  /** Last telemetry of a member, or null when it is missing / too old. */
  private async freshValue(
    userId: string,
    deviceId: string,
  ): Promise<string | null> {
    const hit = this.telemetry.get(this.membershipCacheKey(userId, deviceId));
    if (hit) return Date.now() - hit.at <= SHARE_FRESH_MS ? hit.value : null;

    // Not seen since the backend started: use the DB copy (flushed every
    // 30 s) only if it is recent.
    const latest = await this.inverterDataService.findLatestByUserIdAndDeviceId(
      userId,
      deviceId,
    );
    if (!latest?.value) return null;
    const at = latest.updatedAt ? new Date(latest.updatedAt).getTime() : 0;
    return Date.now() - at <= SHARE_FRESH_MS + 30_000 ? latest.value : null;
  }

  /** Firmware the device reports (cached 5 min), null when unknown. */
  private async firmwareOf(
    userId: string,
    deviceId: string,
  ): Promise<string | null> {
    const key = this.membershipCacheKey(userId, deviceId);
    const hit = this.fwCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.fw;
    let fw: string | null = null;
    try {
      const d = await this.inverterDeviceModel
        .findOne({ userId, deviceId }, { firmwareVersion: 1 })
        .lean()
        .maxTimeMS(2000)
        .exec();
      fw = d?.firmwareVersion || null;
    } catch {
      // Unknown -> treated as old firmware (the safe side).
    }
    if (this.fwCache.size > 5000) this.fwCache.clear();
    this.fwCache.set(key, { at: Date.now(), fw });
    return fw;
  }

  /** fw >= 1.0.8: share expires on the device and -1 stops it at once. */
  private async hasShareExpiry(
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    const fw = await this.firmwareOf(userId, deviceId);
    return !!fw && compareFirmwareVersions(fw, SHARE_EXPIRY_MIN_FW) >= 0;
  }

  /**
   * Devices that leave sharing (group off / deleted / member removed): new
   * firmware gets {"value": -1} and drops the share immediately; every device
   * is told to re-fetch its setting + schedule (old firmware relies on that).
   */
  private async stopSharing(userId: string, deviceIds: string[]) {
    for (const deviceId of deviceIds) {
      const key = this.membershipCacheKey(userId, deviceId);
      this.lastSent.delete(key);
      this.telemetry.delete(key);
      if (await this.hasShareExpiry(userId, deviceId)) {
        void this.mqttService.emitShareValue(userId, deviceId, -1);
      }
    }
  }

  /**
   * Watts each active member should discharge.
   * pool   = Σ consumption (grid + discharge) of the active members
   * active = grid-tie ON and sending data (offline members would otherwise
   *          keep a stale load in the pool and a share of the ratio)
   * split  = by ratio. Share overrides the member's own setting/schedule on
   *          the device, so the only cap is the 4-digit field (8999 W).
   */
  private async computeGroup(
    userId: string,
    group: ShareGroup,
    trigger?: { deviceId: string; value: string },
  ): Promise<Record<string, number>> {
    let pool = 0;
    const active: ShareSlot[] = [];

    for (const member of group.members) {
      if (await this.gridTieService.isOff(userId, member.deviceId)) continue;

      const value =
        trigger && member.deviceId === trigger.deviceId
          ? trigger.value
          : await this.freshValue(userId, member.deviceId);
      if (!value) continue; // offline / no data: out of the pool and the split

      pool += this.parsePEnergy(value);
      active.push({
        deviceId: member.deviceId,
        ratio: member.ratio,
        // Share has priority over the setting/schedule on the device: only
        // the 4-digit field limits it.
        cap: SHARE_MAX_WATTS,
      });
    }

    return allocateShare(pool, active);
  }

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

  /** Same-grid-line clusters of a user's devices (see gridClustersOf). */
  async gridClusters(userId: string): Promise<Map<string, string>> {
    const groups = await this.shareGroupModel
      .find({ userId }, { members: 1 })
      .lean()
      .maxTimeMS(5000)
      .exec();
    return gridClustersOf(groups);
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

    const values = await this.computeGroup(userId, group);

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
   * Setting value an OLD (< 1.0.8, no MQTT share expiry) ESP32 gets while it
   * shares (GET ?source=hardware):
   * first 4 digits (battery cut-off voltage) kept, power field replaced by the
   * share, encoded like every setting (watts + 1000). Share has priority
   * over the setting, so the user's own max discharge does not limit it.
   *   "48002000" (48 V / 1000 W), share 387 W -> "48001387"
   * Returns null when share doesn't apply or the value can't be parsed.
   */
  async getHardwareSettingValue(
    userId: string,
    deviceId: string,
    settingValue: string,
  ): Promise<string | null> {
    if (!settingValue || !/^\d{8}/.test(settingValue)) return null;
    // fw >= 1.0.8 gets the share over MQTT (with its 30 s expiry): keep the
    // real setting here so the device falls back to it when the share stops.
    if (await this.hasShareExpiry(userId, deviceId)) return null;

    const computed = await this.computeValue(userId, deviceId);
    if (computed === null) return null;

    return settingValue.slice(0, 4) + encodeShareWatts(computed);
  }

  /**
   * Same for the schedule: every `value=VVVVPPPP` slot keeps its voltage and
   * gets share + 1000. Times are untouched.
   * Returns null when share doesn't apply.
   */
  async getHardwareScheduleValue(
    userId: string,
    deviceId: string,
    schedule: string,
  ): Promise<string | null> {
    if (!schedule) return null;
    if (await this.hasShareExpiry(userId, deviceId)) return null;

    const computed = await this.computeValue(userId, deviceId);
    if (computed === null) return null;

    return schedule.replace(
      /value=(\d{4})(\d{4})/g,
      (_match, head: string): string =>
        `value=${head}${encodeShareWatts(computed)}`,
    );
  }

  // ---- CRUD (mobile) ----

  /** One entry per device (the last one wins). */
  private dedupe(members: ShareMember[]): ShareMember[] {
    const byId = new Map<string, ShareMember>();
    for (const m of members) {
      byId.set(m.deviceId, { deviceId: m.deviceId, ratio: m.ratio });
    }
    return [...byId.values()];
  }

  /**
   * A device may be in one ENABLED group only (otherwise its share would come
   * from whichever group the lookup happens to return).
   */
  private async assertNotInOtherGroup(
    userId: string,
    members: ShareMember[],
    exceptGroupId?: string,
  ): Promise<void> {
    if (!members.length) return;
    const filter: Record<string, unknown> = {
      userId,
      enabled: true,
      'members.deviceId': { $in: members.map((m) => m.deviceId) },
    };
    if (exceptGroupId) filter._id = { $ne: exceptGroupId };
    const other = await this.shareGroupModel.findOne(filter).lean().exec();
    if (other) {
      const ids = new Set(members.map((m) => m.deviceId));
      const dup = other.members.find((m) => ids.has(m.deviceId));
      throw new BadRequestException(
        `Thiết bị ${dup?.deviceId ?? ''} đang ở nhóm chia sẻ "${other.name || 'khác'}" - tắt hoặc bỏ nó khỏi nhóm đó trước`,
      );
    }
  }

  async createGroup(
    userId: string,
    dto: CreateShareGroupDto,
  ): Promise<ShareGroup> {
    const members = this.dedupe(dto.members);
    if ((dto.enabled ?? true) === true) {
      await this.assertNotInOtherGroup(userId, members);
    }
    const created = new this.shareGroupModel({
      userId,
      name: dto.name,
      enabled: dto.enabled ?? true,
      members,
      updatedAt: new Date(),
    });
    const saved = await created.save();
    this.clearMembershipCache();
    this.notifyMembers(
      userId,
      saved.members.map((m) => m.deviceId),
    );
    return saved;
  }

  /**
   * Live state of a group for the app's overview: each member's latest frame
   * (null when offline), grid-tie status and the watts the group gives it
   * right now (null when the group is off or the member is not active).
   * Read-only: nothing is published.
   */
  async groupLive(
    userId: string,
    groupId: string,
  ): Promise<{
    group: ShareGroup;
    poolWatts: number;
    members: Array<{
      deviceId: string;
      ratio: number;
      value: string | null;
      gridTieOff: boolean;
      assignedWatts: number | null;
    }>;
  } | null> {
    const group = await this.getGroup(userId, groupId);
    if (!group) return null;
    const members = await Promise.all(
      group.members.map(async (m) => {
        const [value, gridTieOff] = await Promise.all([
          this.freshValue(userId, m.deviceId),
          this.gridTieService.isOff(userId, m.deviceId),
        ]);
        return { deviceId: m.deviceId, ratio: m.ratio, value, gridTieOff };
      }),
    );
    let poolWatts = 0;
    const active: ShareSlot[] = [];
    for (const m of members) {
      if (m.gridTieOff || !m.value) continue;
      poolWatts += this.parsePEnergy(m.value);
      active.push({
        deviceId: m.deviceId,
        ratio: m.ratio,
        cap: SHARE_MAX_WATTS,
      });
    }
    const assigned = group.enabled ? allocateShare(poolWatts, active) : {};
    return {
      group,
      poolWatts: Math.round(poolWatts),
      members: members.map((m) => ({
        ...m,
        assignedWatts: assigned[m.deviceId] ?? null,
      })),
    };
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
    const current = await this.shareGroupModel
      .findOne({ _id: groupId, userId })
      .lean()
      .exec();
    if (!current) return null;
    const members = dto.members ? this.dedupe(dto.members) : current.members;
    const enabled = dto.enabled ?? current.enabled;
    if (enabled) await this.assertNotInOtherGroup(userId, members, groupId);
    const updated = await this.shareGroupModel
      .findOneAndUpdate(
        { _id: groupId, userId },
        {
          ...dto,
          ...(dto.members ? { members } : {}),
          updatedAt: new Date(),
        },
        { new: true },
      )
      .lean()
      .exec();
    // Members/ratios/enabled may have changed - drop the cached computation.
    await this.invalidateGroupCache(groupId);
    if (updated) {
      this.clearMembershipCache();
      const before = current.enabled
        ? current.members.map((m) => m.deviceId)
        : [];
      const after = updated.enabled
        ? updated.members.map((m) => m.deviceId)
        : [];
      const left = before.filter((id) => !after.includes(id));
      await this.stopSharing(userId, left);
      // Old and new members: those leaving drop the share, the others pick
      // up the new split.
      this.notifyMembers(userId, [
        ...current.members.map((m) => m.deviceId),
        ...updated.members.map((m) => m.deviceId),
      ]);
    }
    return updated;
  }

  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(groupId)) return false;
    const deleted = await this.shareGroupModel
      .findOneAndDelete({ _id: groupId, userId })
      .lean()
      .exec();
    await this.invalidateGroupCache(groupId);
    if (deleted) {
      this.clearMembershipCache();
      if (deleted.enabled) {
        await this.stopSharing(
          userId,
          deleted.members.map((m) => m.deviceId),
        );
      }
      this.notifyMembers(
        userId,
        deleted.members.map((m) => m.deviceId),
      );
    }
    return !!deleted;
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
