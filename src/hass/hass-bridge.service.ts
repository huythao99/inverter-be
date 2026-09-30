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
  MqttCredential,
  MqttCredentialDocument,
} from '../models/mqtt-credential.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';
import { MqttService } from '../services/mqtt.service';
import { DailyTotalsService } from '../services/daily-totals.service';
import {
  availabilityTopic,
  chargerState,
  discoveryMessages,
  discoveryTopics,
  HASS_STATE_ROOT,
  HassDevice,
  hassEnabled,
  HassKind,
  hassPrefixFor,
  inverterState,
  stateTopic,
} from './hass-discovery';

/** An `ha_` account counts as connected when seen within this window. */
export const HASS_ACTIVE_MS = 15 * 60_000;
/** State of a device is sent at most this often (devices report every ~1-3 s). */
export const HASS_STATE_EVERY_MS = 30_000;
/** No data for this long = device offline in Home Assistant. */
export const HASS_OFFLINE_MS = 90_000;
const REFRESH_MS = 60_000;
const REDISCOVER_MS = 30 * 60_000;
const ENERGY_EVERY_MS = 5 * 60_000;
/**
 * A connected-but-idle Home Assistant causes no ACL check, so it would never
 * look "connected" again. A small non-retained message to every enabled
 * account makes the broker re-check (go-auth caches ACLs for 5 min).
 */
const HEARTBEAT_MS = 5 * 60_000;

interface Latest {
  uid: string;
  kind: HassKind;
  deviceId: string;
  state: Record<string, unknown>;
  dirty: boolean;
  lastDataAt: number;
  online: boolean;
}

/**
 * Feeds Home Assistant (read-only, phase 1). Only for users whose `ha_`
 * account is currently connected (seen by the broker's ACL checks), and at
 * most one state message per device every 30 s. No extra MQTT subscription:
 * it reuses the data events of the primary MqttService instance.
 */
@Injectable()
export class HassBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HassBridgeService.name);
  private readonly isPrimary: boolean;
  private active = new Map<string, { prefix: string; discoveredAt: number }>();
  private readonly discovered = new Map<string, Map<string, HassDevice>>();
  private readonly latest = new Map<string, Latest>();
  private readonly energy = new Map<
    string,
    { at: number; today: number | null; grid: number | null }
  >();
  private timers: NodeJS.Timeout[] = [];
  private sentThisMinute = 0;
  private sentLastMinute = 0;
  private lastHeartbeat = 0;

  constructor(
    @InjectModel(MqttCredential.name)
    private readonly credModel: Model<MqttCredentialDocument>,
    @InjectModel(InverterDevice.name)
    private readonly inverterModel: Model<InverterDeviceDocument>,
    @InjectModel(ChargerDevice.name)
    private readonly chargerModel: Model<ChargerDeviceDocument>,
    private readonly mqtt: MqttService,
    private readonly dailyTotals: DailyTotalsService,
  ) {
    // Same rule as MqttService: device events only fire on the primary.
    const instanceId = process.env.NODE_APP_INSTANCE;
    const primaryId = process.env.MQTT_PRIMARY_INSTANCE || '0';
    this.isPrimary = instanceId === undefined || instanceId === primaryId;
  }

  onModuleInit(): void {
    if (!this.isPrimary || process.env.NODE_ENV === 'test') return;
    if (!hassEnabled()) {
      this.logger.log('Home Assistant disabled (HASS_ENABLED=false)');
      return;
    }
    this.timers.push(
      setInterval(() => void this.refreshActive(), REFRESH_MS),
      setInterval(() => void this.flush(), HASS_STATE_EVERY_MS),
      setInterval(() => {
        this.sentLastMinute = this.sentThisMinute;
        this.sentThisMinute = 0;
      }, 60_000),
    );
    setTimeout(() => void this.refreshActive(), 15_000);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
  }

  /** For the CMS: accounts connected now and messages sent last minute. */
  async stats() {
    const since = new Date(Date.now() - HASS_ACTIVE_MS);
    const [total, connected] = await Promise.all([
      this.credModel.countDocuments({ kind: 'ha', isActive: true }),
      this.credModel.countDocuments({
        kind: 'ha',
        isActive: true,
        lastUsedAt: { $gte: since },
      }),
    ]);
    return {
      accounts: total,
      connected,
      messagesLastMinute: this.isPrimary ? this.sentLastMinute : null,
    };
  }

  // ---- active accounts + discovery ---------------------------------------

  async refreshActive(): Promise<void> {
    try {
      await this.heartbeat();
      const since = new Date(Date.now() - HASS_ACTIVE_MS);
      const creds = await this.credModel
        .find({ kind: 'ha', isActive: true, lastUsedAt: { $gte: since } })
        .select({ userId: 1, mqttUsername: 1 })
        .lean()
        .exec();
      const next = new Map<string, { prefix: string; discoveredAt: number }>();
      for (const c of creds) {
        const prev = this.active.get(c.userId);
        next.set(c.userId, {
          prefix: hassPrefixFor(c.mqttUsername),
          discoveredAt: prev?.discoveredAt ?? 0,
        });
      }
      // Users who left: stop sending their data.
      for (const uid of this.active.keys()) {
        if (!next.has(uid)) this.dropUser(uid);
      }
      this.active = next;
      const now = Date.now();
      for (const [uid, a] of next) {
        if (now - a.discoveredAt >= REDISCOVER_MS) {
          a.discoveredAt = now;
          await this.publishDiscovery(uid, a.prefix);
        }
      }
    } catch (e) {
      this.logger.warn(`refreshActive: ${(e as Error).message}`);
    }
  }

  private async heartbeat(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHeartbeat < HEARTBEAT_MS) return;
    this.lastHeartbeat = now;
    const all = await this.credModel
      .find({ kind: 'ha', isActive: true })
      .select({ userId: 1 })
      .lean()
      .exec();
    for (const c of all) {
      await this.send(
        `${HASS_STATE_ROOT}/${c.userId}/heartbeat`,
        String(Math.floor(now / 1000)),
        false,
      );
    }
  }

  /**
   * Account turned off: remove its retained discovery + availability from the
   * broker (empty retained message) and stop sending. Runs on any instance.
   */
  async clearUser(uid: string, mqttUsername: string): Promise<void> {
    const prefix = hassPrefixFor(mqttUsername);
    for (const d of await this.userDevices(uid)) {
      for (const t of discoveryTopics(prefix, d)) await this.send(t, '', true);
      await this.send(availabilityTopic(uid, d.deviceId), '', true);
    }
    this.active.delete(uid);
    this.discovered.delete(uid);
    this.dropUser(uid);
  }

  private dropUser(uid: string): void {
    for (const [k, v] of this.latest) if (v.uid === uid) this.latest.delete(k);
  }

  private async userDevices(uid: string): Promise<HassDevice[]> {
    const [inv, chg] = await Promise.all([
      this.inverterModel
        .find({ userId: uid })
        .select({ deviceId: 1, deviceName: 1, firmwareVersion: 1 })
        .lean()
        .exec(),
      this.chargerModel
        .find({ userId: uid })
        .select({ deviceId: 1, deviceName: 1, firmwareVersion: 1 })
        .lean()
        .exec(),
    ]);
    return [
      ...inv.map((d) => ({
        kind: 'inverter' as const,
        deviceId: d.deviceId,
        name: d.deviceName,
        firmware: d.firmwareVersion,
      })),
      ...chg.map((d) => ({
        kind: 'charger' as const,
        deviceId: d.deviceId,
        name: d.deviceName,
        firmware: d.firmwareVersion,
      })),
    ];
  }

  /** (Re)publish retained discovery; clear it for devices that are gone. */
  async publishDiscovery(uid: string, prefix: string): Promise<void> {
    const devices = await this.userDevices(uid);
    const before = this.discovered.get(uid) ?? new Map<string, HassDevice>();
    const now = new Map<string, HassDevice>();
    for (const d of devices) {
      now.set(`${d.kind}:${d.deviceId}`, d);
      for (const m of discoveryMessages(uid, prefix, d)) {
        await this.send(m.topic, m.payload, true);
      }
      const key = this.key(d.kind, uid, d.deviceId);
      if (!this.latest.has(key)) {
        await this.send(availabilityTopic(uid, d.deviceId), 'offline', true);
      }
    }
    for (const [k, d] of before) {
      if (now.has(k)) continue;
      for (const t of discoveryTopics(prefix, d)) await this.send(t, '', true);
    }
    this.discovered.set(uid, now);
  }

  // ---- device data ---------------------------------------------------------

  private key(kind: HassKind, uid: string, deviceId: string): string {
    return `${kind}:${uid}:${deviceId}`;
  }

  private update(
    kind: HassKind,
    uid: string,
    deviceId: string,
    state: Record<string, unknown> | null,
  ): void {
    if (!this.active.has(uid)) return;
    const key = this.key(kind, uid, deviceId);
    const now = Date.now();
    let e = this.latest.get(key);
    if (!e) {
      e = {
        uid,
        kind,
        deviceId,
        state: {},
        dirty: false,
        lastDataAt: 0,
        online: false,
      };
      this.latest.set(key, e);
    }
    e.lastDataAt = now;
    if (state) {
      e.state = { ...e.state, ...state };
      e.dirty = true;
    }
    if (!e.online) {
      e.online = true;
      void this.send(availabilityTopic(uid, deviceId), 'online', true);
    }
  }

  @OnEvent('inverter.data.received')
  onInverterData(p: {
    currentUid: string;
    wifiSsid: string;
    data?: { value?: string };
  }): void {
    if (!this.active.has(p.currentUid)) return;
    this.update(
      'inverter',
      p.currentUid,
      p.wifiSsid,
      inverterState(p.data?.value ?? ''),
    );
  }

  @OnEvent('charger.data.received')
  onChargerData(p: {
    userId: string;
    deviceId: string;
    data?: Record<string, string>;
  }): void {
    if (!this.active.has(p.userId)) return;
    this.update('charger', p.userId, p.deviceId, chargerState(p.data ?? {}));
  }

  @OnEvent('charger.status.received')
  onChargerStatus(p: { userId: string; deviceId: string }): void {
    if (!this.active.has(p.userId)) return;
    this.update('charger', p.userId, p.deviceId, null);
  }

  private todayGmt7(): string {
    return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  }

  /** Today's kWh (xả / lấy lưới) of an inverter, refreshed every 5 min. */
  private async energyFor(uid: string, deviceId: string) {
    const key = `${uid}:${deviceId}`;
    const hit = this.energy.get(key);
    if (hit && Date.now() - hit.at < ENERGY_EVERY_MS) return hit;
    let today: number | null = null;
    let grid: number | null = null;
    try {
      const rows = await this.dailyTotals.getDailyTotalsByDay(
        uid,
        deviceId,
        this.todayGmt7(),
      );
      today = rows.reduce((s, r) => s + (Number(r.totalA) || 0), 0);
      grid = rows.reduce((s, r) => s + (Number(r.totalA2) || 0), 0);
      today = Math.round(today * 100) / 100;
      grid = Math.round(grid * 100) / 100;
    } catch {
      /* keep null */
    }
    const v = { at: Date.now(), today, grid };
    this.energy.set(key, v);
    return v;
  }

  /** Every 30 s: send changed states, mark silent devices offline. */
  async flush(): Promise<void> {
    const now = Date.now();
    for (const e of this.latest.values()) {
      if (!this.active.has(e.uid)) continue;
      if (e.online && now - e.lastDataAt > HASS_OFFLINE_MS) {
        e.online = false;
        await this.send(availabilityTopic(e.uid, e.deviceId), 'offline', true);
      }
      if (!e.dirty) continue;
      e.dirty = false;
      const payload: Record<string, unknown> = { ...e.state };
      if (e.kind === 'inverter') {
        const en = await this.energyFor(e.uid, e.deviceId);
        payload.energy_today = en.today;
        payload.grid_energy_today = en.grid;
      }
      await this.send(stateTopic(e.uid, e.deviceId), payload, false);
    }
  }

  private async send(
    topic: string,
    payload: unknown,
    retain: boolean,
  ): Promise<void> {
    try {
      await this.mqtt.publishWithRetain(topic, payload, retain);
      this.sentThisMinute++;
    } catch (e) {
      this.logger.debug(`publish ${topic}: ${(e as Error).message}`);
    }
  }
}
