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
  HybridData,
  HybridDataDocument,
  HybridNak,
} from '../models/hybrid-data.schema';
import {
  HybridEnergy,
  HybridEnergyDocument,
} from '../models/hybrid-energy.schema';
import {
  ChargerDataEventPayload,
  ChargerStatusEventPayload,
} from './charger-data.service';
import {
  HYBRID_ENERGY_KEYS,
  HybridEnergyKey,
  HybridEnergyRef,
  hybridEnergyDelta,
  hybridEnergyRef,
  vnDay,
  hybridEtot,
  hybridEtotDelta,
  type HybridEtot,
} from '../constants/hybrid.constants';

// While a device sent $ETOT this recently, energy is counted from $ETOT only
// ($TLM counters still followed, not counted). Older STM32 firmware without
// $ETOT keeps the $TLM counting.
const ETOT_FRESH_MS = 15 * 60_000;

// Offline when no message arrived within this window (same as the charger).
const OFFLINE_THRESHOLD_MS = 15000;
const ENERGY_FLUSH_MS = 60_000;

/** "$NAK,SET,ERR=RANGE,KEY=PEXP*xx" -> { type, words, items }. */
export function parseHinvlfFrame(raw: string): {
  type: string;
  words: string[];
  items: Record<string, string>;
} | null {
  const t = (raw ?? '').trim();
  const dollar = t.indexOf('$');
  if (dollar < 0) return null;
  const star = t.lastIndexOf('*');
  const body = star > dollar ? t.slice(dollar + 1, star) : t.slice(dollar + 1);
  const [type, ...rest] = body.split(',');
  if (!type) return null;
  const words: string[] = [];
  const items: Record<string, string> = {};
  for (const it of rest) {
    const eq = it.indexOf('=');
    if (eq > 0) items[it.slice(0, eq)] = it.slice(eq + 1);
    else if (it) words.push(it);
  }
  return { type: type.toUpperCase(), words, items };
}

type EnergyTotals = Record<HybridEnergyKey, number>;

export interface HybridEnergyDay {
  day: string;
  edis: number;
  echg: number;
  eimp: number;
  eexp: number;
}

/**
 * Latest state of each hybrid (hybrid/{uid}/{dev}/(data|status)) + daily
 * energy from the $TLM counters (accumulated in memory, flushed every 60 s).
 */
// lastNak is stored as-is and never cleared, so it is only shown while it
// still means something:
//  - a $CFG received after it = the device re-reported its settings (a SET is
//    followed by $CFG once accepted) -> over;
//  - BUSY (menu open on the machine), LOCAL, FLASH, CRC: the ESP32 retries by
//    itself every few seconds -> only the last 2 minutes;
//  - other errors (RANGE, VALUE, KEY, ...): 24 hours.
const NAK_TRANSIENT = new Set(['BUSY', 'LOCAL', 'FLASH', 'CRC']);
const NAK_TRANSIENT_MS = 2 * 60_000;
const NAK_MAX_MS = 24 * 3600_000;

export function activeHybridNak(
  nak: HybridNak | undefined | null,
  cfgAt?: Date | string | null,
  now = Date.now(),
): HybridNak | null {
  if (!nak?.at) return null;
  const at = new Date(nak.at).getTime();
  if (!Number.isFinite(at)) return null;
  if (cfgAt && new Date(cfgAt).getTime() > at) return null;
  const maxAge = NAK_TRANSIENT.has(nak.err) ? NAK_TRANSIENT_MS : NAK_MAX_MS;
  return now - at < maxAge ? nak : null;
}

@Injectable()
export class HybridDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HybridDataService.name);
  /** uid|dev -> counters of the last $TLM. */
  private readonly refs = new Map<string, HybridEnergyRef & { at: number }>();
  /** uid|dev -> largest $ETOT seen + when the last $ETOT came. */
  private readonly etots = new Map<string, { max: HybridEtot; at: number }>();
  /** uid|dev|day -> energy not yet written. */
  private readonly pending = new Map<string, EnergyTotals>();
  /** Per-device chain so two frames never race on the same ref. */
  private readonly chains = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(HybridData.name)
    private readonly model: Model<HybridDataDocument>,
    @InjectModel(HybridEnergy.name)
    private readonly energyModel: Model<HybridEnergyDocument>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flushEnergy(), ENERGY_FLUSH_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.flushEnergy();
  }

  async findLatest(
    userId: string,
    deviceId: string,
  ): Promise<HybridData | null> {
    const doc = (await this.model
      .findOne({ userId, deviceId })
      .select('-__v')
      .lean()
      .exec()) as HybridData | null;
    if (!doc) return null;
    const lastSeen = doc.lastSeenAt ? new Date(doc.lastSeenAt).getTime() : 0;
    const online = Date.now() - lastSeen < OFFLINE_THRESHOLD_MS;
    return {
      ...doc,
      lastNak: activeHybridNak(doc.lastNak, doc.cfgAt) ?? undefined,
      status: online ? 'online' : 'offline',
    };
  }

  @OnEvent('hybrid.data.received')
  onData(payload: ChargerDataEventPayload): void {
    const raw = typeof payload.data?.raw === 'string' ? payload.data.raw : '';
    const frame = parseHinvlfFrame(raw);
    if (!frame) return;
    const key = `${payload.userId}|${payload.deviceId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() =>
        this.handleFrame(payload.userId, payload.deviceId, frame, raw),
      )
      .catch((e: unknown) =>
        this.logger.warn(`hybrid frame ${key}: ${String(e)}`),
      );
    this.chains.set(key, next);
    void next.then(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  private async handleFrame(
    userId: string,
    deviceId: string,
    frame: NonNullable<ReturnType<typeof parseHinvlfFrame>>,
    raw: string,
  ): Promise<void> {
    const now = new Date();
    const set: Record<string, unknown> = {
      userId,
      deviceId,
      status: 'online',
      lastSeenAt: now,
      updatedAt: now,
    };

    if (frame.type === 'TLM') {
      set.tlm = frame.items;
      set.tlmAt = now;
      const ref = hybridEnergyRef(frame.items);
      if (ref) {
        await this.addEnergy(userId, deviceId, ref, now);
        set.energyRef = { ...ref, at: now };
      }
    } else if (frame.type === 'ETOT') {
      const etot = hybridEtot(frame.items);
      if (!etot) return;
      set.etot = etot;
      set.etotAt = now;
      set.etotMax = await this.addEtot(userId, deviceId, etot, now);
    } else if (frame.type === 'CFG') {
      set.cfg = frame.items;
      set.cfgAt = now;
    } else if (frame.type === 'INFO') {
      set.info = frame.items;
      set.infoAt = now;
    } else if (frame.type === 'NAK') {
      const nak: HybridNak = {
        of: frame.words.join(' ') || '?',
        err: frame.items.ERR ?? '?',
        raw,
        at: now,
      };
      if (frame.items.KEY) nak.key = frame.items.KEY;
      set.lastNak = nak;
    } else {
      return;
    }

    await this.model
      .updateOne({ userId, deviceId }, { $set: set }, { upsert: true })
      .exec();
  }

  private async addEnergy(
    userId: string,
    deviceId: string,
    ref: HybridEnergyRef,
    now: Date,
  ): Promise<void> {
    const key = `${userId}|${deviceId}`;
    let prev = this.refs.get(key);
    if (!prev) {
      // Backend restarted: continue from the counters stored with the data.
      const doc = (await this.model
        .findOne({ userId, deviceId })
        .select('+energyRef')
        .lean()
        .exec()) as { energyRef?: HybridEnergyRef & { at: Date } } | null;
      if (doc?.energyRef) {
        prev = { ...doc.energyRef, at: new Date(doc.energyRef.at).getTime() };
      }
    }
    this.refs.set(key, { ...ref, at: now.getTime() });
    if (!prev) return; // first frame ever: nothing to add yet
    // $ETOT is the source while the STM32 sends it (no double counting); the
    // ref above is still moved on so a fallback starts from here.
    if (await this.etotFresh(key, now.getTime())) return;

    const elapsedSec = (now.getTime() - prev.at) / 1000;
    const delta = hybridEnergyDelta(prev, ref, elapsedSec);
    if (HYBRID_ENERGY_KEYS.every((k) => delta[k] === 0)) return;
    const pkey = `${key}|${vnDay(now)}`;
    const acc =
      this.pending.get(pkey) ??
      ({ EDIS: 0, ECHG: 0, EIMP: 0, EEXP: 0 } as EnergyTotals);
    for (const k of HYBRID_ENERGY_KEYS) acc[k] += delta[k];
    this.pending.set(pkey, acc);
  }

  private async loadEtot(
    key: string,
  ): Promise<{ max: HybridEtot; at: number } | undefined> {
    let e = this.etots.get(key);
    if (e) return e;
    const [userId, deviceId] = key.split('|');
    const doc = (await this.model
      .findOne({ userId, deviceId })
      .select('+etotMax etotAt')
      .lean()
      .exec()) as { etotMax?: HybridEtot; etotAt?: Date } | null;
    if (doc?.etotMax) {
      e = {
        max: doc.etotMax,
        at: doc.etotAt ? new Date(doc.etotAt).getTime() : 0,
      };
      this.etots.set(key, e);
    }
    return e;
  }

  private async etotFresh(key: string, now: number): Promise<boolean> {
    const e = await this.loadEtot(key);
    return !!e && now - e.at < ETOT_FRESH_MS;
  }

  /**
   * Count a $ETOT: energy since the largest totals seen, into today's VN day.
   * The first $ETOT ever (or after the device was removed) only sets the
   * starting point. Returns the new largest totals (stored with the data).
   */
  private async addEtot(
    userId: string,
    deviceId: string,
    etot: HybridEtot,
    now: Date,
  ): Promise<HybridEtot> {
    const key = `${userId}|${deviceId}`;
    const prev = await this.loadEtot(key);
    if (!prev) {
      this.etots.set(key, { max: etot, at: now.getTime() });
      return etot;
    }
    const { delta, max } = hybridEtotDelta(prev.max, etot);
    this.etots.set(key, { max, at: now.getTime() });
    if (HYBRID_ENERGY_KEYS.some((k) => delta[k] > 0)) {
      const pkey = `${key}|${vnDay(now)}`;
      const acc =
        this.pending.get(pkey) ??
        ({ EDIS: 0, ECHG: 0, EIMP: 0, EEXP: 0 } as EnergyTotals);
      for (const k of HYBRID_ENERGY_KEYS) acc[k] += delta[k];
      this.pending.set(pkey, acc);
    }
    return max;
  }

  /** Write the accumulated energy ($inc per device and day). */
  async flushEnergy(): Promise<void> {
    if (this.pending.size === 0) return;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    const ops = entries.map(([pkey, e]) => {
      const [userId, deviceId, day] = pkey.split('|');
      return {
        updateOne: {
          filter: { userId, deviceId, day },
          update: {
            $inc: { edis: e.EDIS, echg: e.ECHG, eimp: e.EIMP, eexp: e.EEXP },
          },
          upsert: true,
        },
      };
    });
    try {
      await this.energyModel.bulkWrite(ops, { ordered: false });
    } catch (e) {
      // Put it back so the next flush retries.
      for (const [pkey, v] of entries) {
        const acc = this.pending.get(pkey);
        if (!acc) this.pending.set(pkey, v);
        else for (const k of HYBRID_ENERGY_KEYS) acc[k] += v[k];
      }
      this.logger.warn(`hybrid energy flush failed: ${String(e)}`);
    }
  }

  /** Daily energy (Wh) between two VN days inclusive, including unflushed. */
  async energy(
    userId: string,
    deviceId: string,
    from: string,
    to: string,
  ): Promise<HybridEnergyDay[]> {
    const docs = (await this.energyModel
      .find({ userId, deviceId, day: { $gte: from, $lte: to } })
      .sort({ day: 1 })
      .lean()
      .exec()) as HybridEnergyDay[];
    const byDay = new Map<string, HybridEnergyDay>(
      docs.map((d) => [
        d.day,
        { day: d.day, edis: d.edis, echg: d.echg, eimp: d.eimp, eexp: d.eexp },
      ]),
    );
    const prefix = `${userId}|${deviceId}|`;
    for (const [pkey, e] of this.pending) {
      if (!pkey.startsWith(prefix)) continue;
      const day = pkey.slice(prefix.length);
      if (day < from || day > to) continue;
      const d = byDay.get(day) ?? { day, edis: 0, echg: 0, eimp: 0, eexp: 0 };
      d.edis += e.EDIS;
      d.echg += e.ECHG;
      d.eimp += e.EIMP;
      d.eexp += e.EEXP;
      byDay.set(day, d);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Forget a removed device (data + energy). */
  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const key = `${userId}|${deviceId}`;
    this.refs.delete(key);
    this.etots.delete(key);
    for (const pkey of [...this.pending.keys()]) {
      if (pkey.startsWith(`${key}|`)) this.pending.delete(pkey);
    }
    await Promise.all([
      this.model.deleteOne({ userId, deviceId }).exec(),
      this.energyModel.deleteMany({ userId, deviceId }).exec(),
    ]);
  }

  @OnEvent('hybrid.status.received')
  onStatus(payload: ChargerStatusEventPayload): void {
    const now = new Date();
    this.model
      .updateOne(
        { userId: payload.userId, deviceId: payload.deviceId },
        {
          $set: {
            userId: payload.userId,
            deviceId: payload.deviceId,
            status: payload.status || 'online',
            lastSeenAt: now,
          },
        },
        { upsert: true },
      )
      .exec()
      .catch(() => {});
  }
}
