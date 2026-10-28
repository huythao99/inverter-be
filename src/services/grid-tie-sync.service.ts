import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  InverterSetting,
  InverterSettingDocument,
} from '../models/inverter-setting.schema';
import { MqttService } from './mqtt.service';
import { GRID_TIE_CHANGED_EVENT } from '../constants/grid-tie.constants';

/** First re-sync this long after the device was seen not to obey OFF. */
export const GRID_TIE_RESYNC_MS = 30_000;
/** After this many re-syncs without effect, slow down (locked, broken...). */
export const GRID_TIE_RESYNC_FAST_TRIES = 6;
export const GRID_TIE_RESYNC_SLOW_MS = 10 * 60_000;

/**
 * Does this telemetry frame show the device applying the OFF command
 * (99.00 V cut-off / 1 W limit, fields 6 and 7)? null = cannot tell.
 */
export function frameShowsGridTieOff(
  value: string | null | undefined,
): boolean | null {
  if (!value || typeof value !== 'string') return null;
  const p = value.replace(/\$/g, '').split('#');
  if (p.length < 8) return null;
  const cutoff = parseFloat(p[6]);
  const limit = parseFloat(p[7]);
  if (Number.isNaN(cutoff) || Number.isNaN(limit)) return null;
  return cutoff >= 98.5 && limit <= 5;
}

/**
 * Delivers grid-tie OFF/ON to the device, two layers:
 *
 * 1. Dedicated retained topic `inverter/{uid}/{dev}/cmd/grid-tie` {"off":bool}.
 *    Firmware that knows it puts OFF right after the blacklist lock and above
 *    share/schedule/setting, and keeps it in NVS. Retained, so a device that
 *    was offline gets it on reconnect. Older firmware is not subscribed and
 *    simply never sees it.
 *
 * 2. Check from telemetry (any firmware). While a device is OFF its frames
 *    must show 99.00 V / 1 W. If not, the device is asked to re-fetch its
 *    setting and schedule (the API serves the OFF value) and the retained
 *    command is published again: every 30 s at first, every 10 min after 6
 *    tries without effect, so a device that cannot obey is not hammered.
 *
 * The OFF list here is a per-process copy (telemetry only reaches the primary
 * pm2 instance, while a toggle may be handled by another one; reload() runs
 * every 60 s). So before sending OFF again it is re-checked in MongoDB: a
 * stale entry must never re-publish a retained OFF over a grid-tie the user
 * just turned back ON (the device then fell back to 99.00 V / 1 W "after a
 * while" until toggled again).
 */
@Injectable()
export class GridTieSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GridTieSyncService.name);
  private readonly isPrimary: boolean;
  private readonly off = new Map<
    string,
    { userId: string; deviceId: string }
  >();
  private readonly resync = new Map<string, { at: number; tries: number }>();
  private seeded = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(InverterSetting.name)
    private readonly settingModel: Model<InverterSettingDocument>,
    private readonly mqtt: MqttService,
  ) {
    // Same rule as MqttService: telemetry only arrives on the primary.
    const instanceId = process.env.NODE_APP_INSTANCE;
    const primaryId = process.env.MQTT_PRIMARY_INSTANCE || '0';
    this.isPrimary = instanceId === undefined || instanceId === primaryId;
  }

  onModuleInit(): void {
    if (!this.isPrimary || process.env.NODE_ENV === 'test') return;
    void this.reload();
    // Picks up OFF changes made through another pm2 instance.
    this.timer = setInterval(() => void this.reload(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private key(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  isOff(userId: string, deviceId: string): boolean {
    return this.off.has(this.key(userId, deviceId));
  }

  /** OFF devices from MongoDB (source of truth). */
  async reload(): Promise<void> {
    let rows: Array<{ userId: string; deviceId: string }>;
    try {
      rows = await this.settingModel
        .find({ gridTieOff: true })
        .select({ userId: 1, deviceId: 1 })
        .lean()
        .exec();
    } catch (e) {
      this.logger.warn(`reload: ${(e as Error).message}`);
      return;
    }
    const before = new Map(this.off);
    this.off.clear();
    for (const r of rows) {
      this.off.set(this.key(r.userId, r.deviceId), {
        userId: r.userId,
        deviceId: r.deviceId,
      });
    }
    for (const k of this.resync.keys()) {
      if (!this.off.has(k)) this.resync.delete(k);
    }
    // Turned back ON (maybe through another instance): make sure the retained
    // command says ON, in case a stale OFF was re-published meanwhile.
    for (const [k, d] of before) {
      if (!this.off.has(k)) await this.publish(d.userId, d.deviceId, false);
    }
    // Once per process: devices turned OFF before this topic existed get
    // their retained command too.
    if (!this.seeded && this.mqtt.isConnected()) {
      this.seeded = true;
      for (const r of rows) await this.publish(r.userId, r.deviceId, true);
      if (rows.length) {
        this.logger.log(`grid-tie: retained OFF for ${rows.length} device(s)`);
      }
    }
  }

  @OnEvent(GRID_TIE_CHANGED_EVENT)
  async onGridTieChanged(p: {
    userId: string;
    deviceId: string;
    off: boolean;
  }): Promise<void> {
    const k = this.key(p.userId, p.deviceId);
    this.resync.delete(k);
    if (p.off) this.off.set(k, { userId: p.userId, deviceId: p.deviceId });
    else this.off.delete(k);
    await this.publish(p.userId, p.deviceId, p.off);
  }

  @OnEvent('inverter.data.received')
  async onTelemetry(p: {
    currentUid: string;
    wifiSsid: string;
    data?: { value?: string };
  }): Promise<void> {
    const k = this.key(p.currentUid, p.wifiSsid);
    if (!this.off.has(k)) return;
    const obeys = frameShowsGridTieOff(p.data?.value);
    if (obeys === null) return;
    if (obeys) {
      const r = this.resync.get(k);
      if (r && r.tries > 0) {
        this.logger.log(
          `grid-tie OFF applied by ${p.wifiSsid} after ${r.tries} re-sync(s)`,
        );
      }
      this.resync.delete(k);
      return;
    }
    const now = Date.now();
    const r = this.resync.get(k);
    if (!r) {
      // First frame seen not obeying: leave the device time for its own fetch.
      this.resync.set(k, { at: now, tries: 0 });
      return;
    }
    const wait =
      r.tries < GRID_TIE_RESYNC_FAST_TRIES
        ? GRID_TIE_RESYNC_MS
        : GRID_TIE_RESYNC_SLOW_MS;
    if (now - r.at < wait) return;
    r.at = now;
    // Still OFF in the source of truth? (The toggle back ON may have been
    // handled by another instance; this copy is then up to 60 s stale.)
    if (!(await this.stillOff(p.currentUid, p.wifiSsid))) {
      this.off.delete(k);
      this.resync.delete(k);
      return;
    }
    r.tries++;
    if (r.tries === GRID_TIE_RESYNC_FAST_TRIES) {
      this.logger.warn(
        `grid-tie OFF not applied by ${p.currentUid}/${p.wifiSsid} ` +
          `after ${r.tries} re-syncs (frame ${p.data?.value})`,
      );
    }
    try {
      await this.mqtt.emitSyncSettings(p.currentUid, p.wifiSsid);
      await this.mqtt.emitSyncSchedule(p.currentUid, p.wifiSsid);
    } catch {
      // next frame retries
    }
    await this.publish(p.currentUid, p.wifiSsid, true);
  }

  private async stillOff(userId: string, deviceId: string): Promise<boolean> {
    try {
      const doc = await this.settingModel
        .exists({ userId, deviceId, gridTieOff: true })
        .exec();
      return !!doc;
    } catch {
      return false; // can't tell: never force OFF on a guess
    }
  }

  private async publish(
    userId: string,
    deviceId: string,
    off: boolean,
  ): Promise<void> {
    try {
      await this.mqtt.emitGridTie(userId, deviceId, off);
    } catch (e) {
      this.logger.warn(
        `grid-tie publish ${userId}/${deviceId}: ${(e as Error).message}`,
      );
    }
  }
}
