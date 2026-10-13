import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { RedisConfig } from '../config/redis.config';
import { DailyTotalsService } from './daily-totals.service';
import { ODOMETER_STEP_LUA } from '../utils/odometer-lua';

/**
 * Daily energy of odometer devices (12/13-number frames) counted frame by
 * frame in Redis, flushed to MongoDB every minute.
 *
 * The STM32 counters are cumulative but can go back: a restart restores the
 * last value saved in flash (or 0), losing what was counted since. Only
 * comparing a few readings per day (max / min / last) cannot see a counter
 * that went back and climbed above yesterday's end again. Here every frame
 * adds its increase over the previous reading; a reading below the baseline
 * becomes the new baseline once confirmed by the next readings (a single
 * corrupted frame never is) - see utils/odometer-lua.ts.
 *
 * Per frame: one EVALSHA (no MongoDB write). Every FLUSH_MS: one updateOne
 * per device-day that changed, with full snapshots ($set / $max / $min), so
 * a repeated or interrupted flush never double counts.
 *
 * Redis unavailable -> the reading goes straight to MongoDB as before and
 * the day is flagged energyGap (reads use the odometer formula for it).
 * Only the primary instance receives device frames (MqttService), and the
 * script is atomic anyway.
 */
@Injectable()
export class OdometerAccumulatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OdometerAccumulatorService.name);
  private redis: Redis | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  static readonly FLUSH_MS = 60_000;
  /** Readings in a row that confirm a counter went back. */
  static readonly CONFIRM_DROP = 2;
  /** Smaller decreases (frames out of order) are not a drop. */
  static readonly TOLERANCE_KWH = 0.005;
  private static readonly DAY_TTL_S = 3 * 24 * 3600;
  private static readonly STATE_TTL_S = 60 * 24 * 3600;
  private static readonly DIRTY = 'odo:dirty';

  constructor(
    private readonly redisConfig: RedisConfig,
    private readonly dailyTotals: DailyTotalsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const r = this.redisConfig.createRedisClient();
      r.on('error', () => {
        // reported by the callers (fallback path)
      });
      r.defineCommand('odoStep', { numberOfKeys: 3, lua: ODOMETER_STEP_LUA });
      await r.connect().catch(() => undefined);
      this.redis = r;
    } catch (err) {
      this.logger.warn(`Redis unavailable: ${(err as Error).message}`);
    }
    // Frames reach the MQTT primary instance only (MqttService): the others
    // have nothing to flush.
    const instanceId = process.env.NODE_APP_INSTANCE;
    const primary = process.env.MQTT_PRIMARY_INSTANCE || '0';
    if (instanceId !== undefined && instanceId !== primary) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, OdometerAccumulatorService.FLUSH_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
    await this.redis?.quit().catch(() => undefined);
  }

  private stateKey(userId: string, deviceId: string) {
    return `odo:s:${userId}:${deviceId}`;
  }

  private dayKey(userId: string, deviceId: string, date: string) {
    return `odo:d:${userId}:${deviceId}:${date}`;
  }

  /** Member of the dirty set: "<date>|<userId>|<deviceId>". */
  private member(userId: string, deviceId: string, date: string) {
    return `${date}|${userId}|${deviceId}`;
  }

  /**
   * One odometer reading (kWh) received on `date` (GMT+7 YYYY-MM-DD).
   * Never throws.
   */
  async onReading(
    userId: string,
    deviceId: string,
    date: string,
    totalA: number,
    totalA2: number,
  ): Promise<void> {
    try {
      if (!this.redis || this.redis.status !== 'ready') {
        throw new Error('redis not ready');
      }
      const keys = [
        this.stateKey(userId, deviceId),
        this.dayKey(userId, deviceId, date),
        OdometerAccumulatorService.DIRTY,
      ];
      const base = [
        String(totalA),
        String(totalA2),
        this.member(userId, deviceId, date),
        String(OdometerAccumulatorService.CONFIRM_DROP),
        String(OdometerAccumulatorService.TOLERANCE_KWH),
        String(OdometerAccumulatorService.DAY_TTL_S),
        String(OdometerAccumulatorService.STATE_TTL_S),
      ];
      const client = this.redis as unknown as {
        odoStep: (...args: string[]) => Promise<string>;
      };
      const step = (...args: string[]): Promise<string> =>
        client.odoStep(...args);
      const res = await step(...keys, ...base, '0', '', '', '', '', '0');
      if (res === 'seed') {
        const seed = await this.dailyTotals.latestOdometerRecord(
          userId,
          deviceId,
          date,
        );
        // Today already has a record: continue its frame-by-frame energy
        // when it has a complete one, otherwise the part of today before
        // this point is unknown here -> flag the day (odometer formula).
        const keepEnergy =
          !!seed?.today &&
          seed.energyA !== null &&
          seed.energyA2 !== null &&
          !seed.energyGap;
        const gap = !!seed?.today && !keepEnergy;
        await step(
          ...keys,
          ...base,
          '1',
          seed ? String(seed.lastA) : '',
          seed ? String(seed.lastA2) : '',
          keepEnergy ? String(seed.energyA) : '',
          keepEnergy ? String(seed.energyA2) : '',
          gap ? '1' : '0',
        );
      }
    } catch {
      // Redis down: keep the readings in MongoDB like before; the day's
      // frame-by-frame energy is now incomplete.
      await this.dailyTotals
        .upsertOdometerReading(userId, deviceId, date, totalA, totalA2, true)
        .catch(() => undefined);
    }
  }

  /** Write every changed device-day to MongoDB (full snapshots). */
  async flush(): Promise<void> {
    const r = this.redis;
    if (this.flushing || !r || r.status !== 'ready') return;
    this.flushing = true;
    try {
      const members = await r.smembers(OdometerAccumulatorService.DIRTY);
      for (const m of members) {
        const [date, userId, deviceId] = m.split('|');
        if (!date || !userId || !deviceId) {
          await r.srem(OdometerAccumulatorService.DIRTY, m);
          continue;
        }
        // Remove first: a frame arriving meanwhile adds it again and the
        // next flush writes it (the snapshot below may already include it).
        await r.srem(OdometerAccumulatorService.DIRTY, m);
        const h = await r.hgetall(this.dayKey(userId, deviceId, date));
        const n = (k: string) => Number(h[k]);
        if (!h || !isFinite(n('lastA')) || !isFinite(n('eA'))) continue;
        try {
          await this.dailyTotals.saveAccumulatedDay(userId, deviceId, date, {
            maxA: n('maxA'),
            maxA2: n('maxA2'),
            minA: n('minA'),
            minA2: n('minA2'),
            lastA: n('lastA'),
            lastA2: n('lastA2'),
            energyA: Math.round(n('eA') * 1e6) / 1e6,
            energyA2: Math.round(n('eA2') * 1e6) / 1e6,
            gap: h.gap === '1',
          });
        } catch {
          // MongoDB failed: retry on the next flush.
          await r.sadd(OdometerAccumulatorService.DIRTY, m);
        }
      }
    } catch (err) {
      this.logger.warn(`odometer flush failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }
}
