import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { AnyBulkWriteOperation, Model } from 'mongoose';
import {
  DeviceHealth,
  DeviceHealthDocument,
} from '../models/device-health.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  compareFirmwareVersions,
  isLegacyDevice,
  newestFirmwareVersion,
} from './firmware.service';

export type HealthIssue =
  | 'offline'
  | 'reboot_loop'
  | 'crash'
  | 'brownout'
  | 'uart'
  | 'plain_mqtt'
  | 'mqtt_fail'
  | 'low_heap'
  | 'weak_wifi'
  | 'outdated';

export const HEALTH_ISSUES: HealthIssue[] = [
  'offline',
  'reboot_loop',
  'crash',
  'brownout',
  'uart',
  'plain_mqtt',
  'mqtt_fail',
  'low_heap',
  'weak_wifi',
  'outdated',
];

/** Issues that count as "has a problem" (outdated firmware is only info). */
const PROBLEM_ISSUES = new Set<HealthIssue>(
  HEALTH_ISSUES.filter((i) => i !== 'outdated'),
);

export const RESET_REASONS: Record<number, string> = {
  0: 'unknown',
  1: 'power-on',
  2: 'external',
  3: 'software',
  4: 'panic',
  5: 'int WDT',
  6: 'task WDT',
  7: 'WDT',
  8: 'deep sleep',
  9: 'brownout',
  10: 'SDIO',
};
const CRASH_REASONS = new Set([4, 5, 6, 7]);

export interface HealthRow {
  userId: string;
  deviceId: string;
  deviceName: string | null;
  firmwareVersion: string | null;
  stmFwVersion: string | null;
  online: boolean;
  lastDataAt: string | null;
  boots24h: number;
  lastBoot: { at: string; reason: number; reasonText: string } | null;
  transport: 'tls' | 'plain' | null;
  rssi: number | null;
  heapMin: number | null;
  uart: { at: string; ok: number; bad: number; raw: string } | null;
  badFrame: { at: string; sample: string } | null;
  mqttFails24h: number;
  issues: HealthIssue[];
}

export interface HealthSummary {
  total: number;
  online: number;
  offline: number;
  withProblems: number;
  issues: Record<HealthIssue, number>;
  firmware: Array<{ version: string; count: number }>;
  resetReasons24h: Array<{ reason: number; text: string; count: number }>;
  newestFirmware: string;
  generatedAt: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Fleet health of the inverters for the CMS.
 *
 * Sources (no extra traffic from the devices):
 * - telemetry frames (inverter.data.received) -> lastDataAt, kept in memory
 *   and flushed to MongoDB once a minute;
 * - the trackLog reports devices already POST (device.log.created): BOOT,
 *   UART_STATS, STM32_BAD_FRAME, STACK_STATS (+ rssi on newer firmware),
 *   MQTT_TRANSPORT, MQTT_TLS_FALLBACK, MQTT_FAILED, OTA_*.
 */
@Injectable()
export class DeviceHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceHealthService.name);
  readonly OFFLINE_MS = 10 * MIN;
  private readonly FLUSH_MS = MIN;
  private readonly CACHE_MS = 30_000;

  /** "uid\tdeviceId" -> last frame time (ms), not yet flushed. */
  private pendingSeen = new Map<string, number>();
  /** Same, everything seen since boot (for live "online" answers). */
  private lastSeen = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private cache: { at: number; rows: HealthRow[] } | null = null;

  constructor(
    @InjectModel(DeviceHealth.name)
    private healthModel: Model<DeviceHealthDocument>,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), this.FLUSH_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private key(userId: string, deviceId: string) {
    return `${userId}\t${deviceId}`;
  }

  @OnEvent('inverter.data.received')
  onData(payload: { currentUid: string; wifiSsid: string }) {
    if (!payload?.currentUid || !payload?.wifiSsid) return;
    const k = this.key(payload.currentUid, payload.wifiSsid);
    const now = Date.now();
    this.pendingSeen.set(k, now);
    this.lastSeen.set(k, now);
  }

  /** Last telemetry time known to this instance (ms) or null. */
  lastSeenAt(userId: string, deviceId: string): number | null {
    return this.lastSeen.get(this.key(userId, deviceId)) ?? null;
  }

  private async flush(): Promise<void> {
    if (this.pendingSeen.size === 0) return;
    const batch = this.pendingSeen;
    this.pendingSeen = new Map();
    const ops: AnyBulkWriteOperation<DeviceHealthDocument>[] = [];
    for (const [k, t] of batch) {
      const [userId, deviceId] = k.split('\t');
      ops.push({
        updateOne: {
          filter: { userId, deviceId },
          update: { $max: { lastDataAt: new Date(t) } },
          upsert: true,
        },
      });
    }
    try {
      for (let i = 0; i < ops.length; i += 1000) {
        await this.healthModel.bulkWrite(ops.slice(i, i + 1000), {
          ordered: false,
        });
      }
    } catch (err) {
      this.logger.warn(`health flush failed: ${(err as Error).message}`);
    }
  }

  /** Parse "a=1 b=2 c=x" into numbers. */
  private kv(msg: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const part of msg.split(/\s+/)) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      const n = Number(part.slice(i + 1));
      if (Number.isFinite(n)) out[part.slice(0, i)] = n;
    }
    return out;
  }

  @OnEvent('device.log.created', { async: true })
  async onLog(log: {
    userId: string;
    deviceId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    if (!log?.userId || !log?.deviceId || !log.errorCode) return;
    const at = new Date();
    const msg = String(log.errorMessage ?? '').slice(0, 300);
    const set: Record<string, unknown> = {
      lastLog: { code: log.errorCode, message: msg, at },
    };
    const push: Record<string, unknown> = {};

    switch (log.errorCode) {
      case 'BOOT': {
        const reason = /reset_reason=(\d+)/.exec(msg);
        const fw = /fw=([\w.-]+)/.exec(msg)?.[1];
        push.boots = {
          $each: [{ at, reason: reason ? Number(reason[1]) : 0, fw }],
          $slice: -20,
        };
        if (fw) set.fw = fw;
        break;
      }
      case 'MQTT_TRANSPORT':
        set.transport = msg.startsWith('tls') ? 'tls' : 'plain';
        set.transportAt = at;
        break;
      case 'MQTT_TLS_FALLBACK':
        set.transport = 'plain';
        set.transportAt = at;
        break;
      case 'MQTT_FAILED':
        push.mqttFails = { $each: [at], $slice: -20 };
        break;
      case 'UART_STATS': {
        const v = this.kv(msg);
        const ok = v.ok ?? 0;
        const bad = Object.entries(v)
          .filter(([k]) => k !== 'ok')
          .reduce((s, [, n]) => s + n, 0);
        set.uart = { at, ok, bad, raw: msg };
        break;
      }
      case 'STM32_BAD_FRAME':
        set.badFrame = { at, sample: msg };
        break;
      case 'STACK_STATS': {
        const v = this.kv(msg);
        if (v.heap !== undefined) {
          set.heap = { at, free: v.heap, min: v.min ?? 0, blk: v.blk ?? 0 };
        }
        if (v.rssi !== undefined && v.rssi !== 0) {
          set.rssi = v.rssi;
          set.rssiAt = at;
        }
        break;
      }
      case 'OTA_PENDING_VERIFY':
        set.ota = { state: 'pending', at };
        break;
      case 'OTA_CONFIRMED':
        set.ota = { state: 'confirmed', at };
        break;
      default:
        break;
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(push).length) update.$push = push;
    try {
      await this.healthModel.updateOne(
        { userId: log.userId, deviceId: log.deviceId },
        update,
        { upsert: true },
      );
      this.cache = null;
    } catch (err) {
      this.logger.warn(`health log update failed: ${(err as Error).message}`);
    }
  }

  // ---- Read side --------------------------------------------------------

  private buildRow(
    d: {
      userId: string;
      deviceId: string;
      deviceName?: string;
      firmwareVersion?: string;
      stmFwVersion?: string | null;
    },
    h: Partial<DeviceHealth> | undefined,
    now: number,
    newest: string,
  ): HealthRow {
    const mem = this.lastSeen.get(this.key(d.userId, d.deviceId));
    const dbSeen = h?.lastDataAt ? new Date(h.lastDataAt).getTime() : 0;
    const seen = Math.max(mem ?? 0, dbSeen) || null;
    const online = !!seen && now - seen < this.OFFLINE_MS;

    const boots = (h?.boots ?? []).filter(
      (b) => now - new Date(b.at).getTime() < 24 * HOUR,
    );
    const lastBootRaw = h?.boots?.length ? h.boots[h.boots.length - 1] : null;
    const mqttFails24h = (h?.mqttFails ?? []).filter(
      (t) => now - new Date(t).getTime() < 24 * HOUR,
    ).length;
    const recent = (at?: Date | null, ms = 2 * HOUR) =>
      !!at && now - new Date(at).getTime() < ms;

    const issues: HealthIssue[] = [];
    if (!online) issues.push('offline');
    if (boots.length >= 3) issues.push('reboot_loop');
    if (boots.some((b) => CRASH_REASONS.has(b.reason))) issues.push('crash');
    if (boots.some((b) => b.reason === 9)) issues.push('brownout');
    const uart = h?.uart && recent(h.uart.at, 30 * MIN) ? h.uart : null;
    if (uart && (uart.ok === 0 || uart.bad / (uart.ok + uart.bad) > 0.1)) {
      issues.push('uart');
    }
    if (h?.transport === 'plain') issues.push('plain_mqtt');
    if (mqttFails24h > 0) issues.push('mqtt_fail');
    if (
      h?.heap &&
      recent(h.heap.at, 2 * HOUR) &&
      h.heap.min > 0 &&
      h.heap.min < 20000
    ) {
      issues.push('low_heap');
    }
    if (h?.rssi && recent(h.rssiAt, 2 * HOUR) && h.rssi < -80) {
      issues.push('weak_wifi');
    }
    const fwNow = d.firmwareVersion || h?.fw || null;
    if (
      fwNow &&
      !isLegacyDevice(d.deviceId) &&
      compareFirmwareVersions(fwNow, newest) < 0
    ) {
      issues.push('outdated');
    }

    const iso = (x?: Date | null) => (x ? new Date(x).toISOString() : null);
    return {
      userId: d.userId,
      deviceId: d.deviceId,
      deviceName: d.deviceName || null,
      firmwareVersion: fwNow,
      stmFwVersion: d.stmFwVersion ?? null,
      online,
      lastDataAt: seen ? new Date(seen).toISOString() : null,
      boots24h: boots.length,
      lastBoot: lastBootRaw
        ? {
            at: iso(lastBootRaw.at)!,
            reason: lastBootRaw.reason,
            reasonText:
              RESET_REASONS[lastBootRaw.reason] ?? String(lastBootRaw.reason),
          }
        : null,
      transport: h?.transport ?? null,
      rssi: h?.rssi && recent(h.rssiAt, 6 * HOUR) ? h.rssi : null,
      heapMin: h?.heap ? h.heap.min : null,
      uart: uart
        ? { at: iso(uart.at)!, ok: uart.ok, bad: uart.bad, raw: uart.raw }
        : null,
      badFrame:
        h?.badFrame && recent(h.badFrame.at, 24 * HOUR)
          ? { at: iso(h.badFrame.at)!, sample: h.badFrame.sample }
          : null,
      mqttFails24h,
      issues,
    };
  }

  /** Every inverter with its health, cached 30 s. */
  async rows(force = false): Promise<HealthRow[]> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < this.CACHE_MS) {
      return this.cache.rows;
    }
    const [devices, health] = await Promise.all([
      this.inverterDeviceModel
        .find(
          {},
          {
            userId: 1,
            deviceId: 1,
            deviceName: 1,
            firmwareVersion: 1,
            stmFwVersion: 1,
          },
        )
        .lean()
        .maxTimeMS(10000)
        .exec(),
      this.healthModel.find({}, { __v: 0 }).lean().maxTimeMS(10000).exec(),
    ]);
    const byKey = new Map(
      health.map((h) => [
        this.key(h.userId, h.deviceId),
        h as Partial<DeviceHealth>,
      ]),
    );
    const newest = newestFirmwareVersion();
    const rows = devices.map((d) =>
      this.buildRow(d, byKey.get(this.key(d.userId, d.deviceId)), now, newest),
    );
    this.cache = { at: now, rows };
    return rows;
  }

  async one(userId: string, deviceId: string): Promise<HealthRow | null> {
    const d = await this.inverterDeviceModel
      .findOne(
        { userId, deviceId },
        {
          userId: 1,
          deviceId: 1,
          deviceName: 1,
          firmwareVersion: 1,
          stmFwVersion: 1,
        },
      )
      .lean()
      .exec();
    if (!d) return null;
    const h = await this.healthModel
      .findOne({ userId, deviceId })
      .lean()
      .exec();
    return this.buildRow(
      d,
      h ?? undefined,
      Date.now(),
      newestFirmwareVersion(),
    );
  }

  async summary(): Promise<HealthSummary> {
    const rows = await this.rows();
    const issues = Object.fromEntries(
      HEALTH_ISSUES.map((i) => [i, 0]),
    ) as Record<HealthIssue, number>;
    const fw = new Map<string, number>();
    const reasons = new Map<number, number>();
    let online = 0;
    let withProblems = 0;
    for (const r of rows) {
      if (r.online) online++;
      if (r.issues.some((i) => PROBLEM_ISSUES.has(i))) withProblems++;
      for (const i of r.issues) issues[i]++;
      const v = r.firmwareVersion ?? 'unknown';
      fw.set(v, (fw.get(v) ?? 0) + 1);
      if (r.lastBoot && Date.now() - Date.parse(r.lastBoot.at) < 24 * HOUR) {
        reasons.set(
          r.lastBoot.reason,
          (reasons.get(r.lastBoot.reason) ?? 0) + 1,
        );
      }
    }
    return {
      total: rows.length,
      online,
      offline: rows.length - online,
      withProblems,
      issues,
      firmware: [...fw.entries()]
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) =>
          a.version === 'unknown'
            ? 1
            : b.version === 'unknown'
              ? -1
              : compareFirmwareVersions(b.version, a.version),
        ),
      resetReasons24h: [...reasons.entries()]
        .map(([reason, count]) => ({
          reason,
          text: RESET_REASONS[reason] ?? String(reason),
          count,
        }))
        .sort((a, b) => b.count - a.count),
      newestFirmware: newestFirmwareVersion(),
      generatedAt: new Date().toISOString(),
    };
  }

  async list(q: {
    issue?: string;
    fw?: string;
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<{
    data: HealthRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    let rows = await this.rows();
    if (q.status === 'online') rows = rows.filter((r) => r.online);
    else if (q.status === 'offline') rows = rows.filter((r) => !r.online);
    else if (q.status === 'problems') {
      rows = rows.filter((r) => r.issues.some((i) => PROBLEM_ISSUES.has(i)));
    }
    if (q.issue && HEALTH_ISSUES.includes(q.issue as HealthIssue)) {
      rows = rows.filter((r) => r.issues.includes(q.issue as HealthIssue));
    }
    if (q.fw)
      rows = rows.filter((r) => (r.firmwareVersion ?? 'unknown') === q.fw);
    const s = q.search?.trim().toLowerCase();
    if (s) {
      rows = rows.filter(
        (r) =>
          r.deviceId.toLowerCase().includes(s) ||
          r.userId.toLowerCase().includes(s) ||
          (r.deviceName ?? '').toLowerCase().includes(s),
      );
    }
    // Most problems first, then the longest offline.
    const score = (r: HealthRow) =>
      r.issues.filter((i) => PROBLEM_ISSUES.has(i) && i !== 'offline').length *
        10 +
      (r.online ? 0 : 1);
    rows = [...rows].sort((a, b) => {
      if (q.sort === 'lastData') {
        return (
          (Date.parse(a.lastDataAt ?? '0') || 0) -
          (Date.parse(b.lastDataAt ?? '0') || 0)
        );
      }
      if (q.sort === 'boots') return b.boots24h - a.boots24h;
      return score(b) - score(a) || a.deviceId.localeCompare(b.deviceId);
    });
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const page = Math.max(Number(q.page) || 1, 1);
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit,
    };
  }
}
