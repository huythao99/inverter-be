/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisConfig } from '../config/redis.config';
import { DailyTotalsService } from './daily-totals.service';

@Injectable()
export class RedisDailyTotalsService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private batchFlushTimer: NodeJS.Timeout | null;
  private dailyResetTimer: NodeJS.Timeout | null;
  private healthCheckTimer: NodeJS.Timeout | null;
  private readonly BATCH_FLUSH_INTERVAL = 300000; // 5 minutes (reduced CPU load)
  private isShuttingDown = false;
  private readonly KEY_PREFIX = 'daily_totals';
  private readonly DIRTY_SET_KEY = 'daily_totals:dirty';
  private readonly PREVIOUS_DAY_KEY = 'daily_totals:previous_day';
  private currentDay: string;

  // Redis health tracking
  private redisHealthy = false;
  private redisFailCount = 0;
  private lastHealthCheck: Date | null = null;

  constructor(
    private redisConfig: RedisConfig,
    private dailyTotalsService: DailyTotalsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.redis = this.redisConfig.createRedisClient();

      // Add error handling for Redis connection
      this.redis.on('error', () => {
        // Redis connection error - silent
      });

      this.redis.on('connect', () => {
        // Redis connecting
      });

      this.redis.on('ready', () => {
        // Redis connected and ready
      });

      // Initialize current day
      this.currentDay = this.getGMT7Date();

      // Explicitly connect since lazyConnect is true
      await this.redis.connect().catch(() => {
        // Failed to connect to Redis - silent
      });

      // Wait for Redis to be ready with timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000); // 5 second timeout

        if (this.redis.status === 'ready') {
          clearTimeout(timeout);
          resolve();
        } else {
          this.redis.once('ready', () => {
            clearTimeout(timeout);
            resolve();
          });
          this.redis.once('error', () => {
            clearTimeout(timeout);
            resolve();
          });
        }
      });

      // Start batch flush timer
      this.batchFlushTimer = setInterval(() => {
        void this.flushDirtyRecordsToDatabase();
      }, this.BATCH_FLUSH_INTERVAL);

      // Start daily reset timer (check every 10 minutes for new day)
      this.dailyResetTimer = setInterval(() => {
        void this.checkForNewDay();
      }, 600000); // Check every 10 minutes (reduced CPU load)

      // Start Redis health check timer (every 60 seconds - reduced CPU)
      this.healthCheckTimer = setInterval(() => {
        void this.checkRedisHealth();
      }, 60000);
    } catch {
      // Failed to initialize Redis Daily Totals Service - silent
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;

    // Clear timers first to prevent new operations
    if (this.batchFlushTimer) {
      clearInterval(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }

    if (this.dailyResetTimer) {
      clearInterval(this.dailyResetTimer);
      this.dailyResetTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    try {
      // Flush any remaining dirty records before shutdown with timeout
      await Promise.race([
        this.flushDirtyRecordsToDatabase(),
        new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
      ]);
    } catch {
      // Error during final flush - silent
    }

    // Gracefully close Redis connection
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Error closing Redis connection - silent
      }
    }
  }

  private getRedisKey(userId: string, deviceId: string, date: string): string {
    return `${this.KEY_PREFIX}:${userId}:${deviceId}:${date}`;
  }

  private getDirtyKey(userId: string, deviceId: string, date: string): string {
    return `${userId}:${deviceId}:${date}`;
  }

  private getGMT7Date(date?: Date): string {
    const now = date || new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);
    return gmt7.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // Resolve a device's daily value from Mongo with autoCalculate deltas applied.
  // getDailyTotalsByDay converts cumulative counters to the real daily value and
  // preserves the per-record autoCalculate flag, which we surface so callers can
  // avoid caching auto values into Redis.
  private async getDailyValueFromDb(
    userId: string,
    deviceId: string,
    date: string,
  ): Promise<{
    totalA: number;
    totalA2: number;
    autoCalculate: boolean;
  } | null> {
    const records = await this.dailyTotalsService.getDailyTotalsByDay(
      userId,
      deviceId,
      date,
    );
    if (!records || records.length === 0) return null;

    const totalA = records.reduce((sum, r) => sum + r.totalA, 0);
    const totalA2 = records.reduce((sum, r) => sum + r.totalA2, 0);
    const autoCalculate = records.some(
      (r) => (r as { autoCalculate?: boolean }).autoCalculate === true,
    );
    return { totalA, totalA2, autoCalculate };
  }

  // Batch increment for multiple devices at once - single Redis pipeline.
  //
  // Redis is the running total for today and is periodically written OVER the
  // Mongo record ($set). If the Redis hash is missing (Redis restarted /
  // flushed / evicted mid-day) a plain HINCRBYFLOAT would restart from 0 and
  // the next flush would overwrite today's Mongo value with a smaller one.
  // So a missing hash is first seeded from Mongo (HSETNX, never overwrites
  // increments that landed in the meantime). If Redis is down, the increments
  // go straight to Mongo; the seed picks them up once Redis is back.
  async incrementDailyTotalsBatch(
    items: Array<{
      userId: string;
      deviceId: string;
      totalA: number;
      totalA2: number;
    }>,
  ): Promise<void> {
    if (this.isShuttingDown || items.length === 0) return;

    const date = this.getGMT7Date();

    if (!this.redis || this.redis.status !== 'ready') {
      await this.incrementInDatabase(items, date);
      return;
    }

    try {
      const keys = items.map((item) =>
        this.getRedisKey(item.userId, item.deviceId, date),
      );

      // Which hashes are missing?
      const existsResults = await this.redis
        .pipeline(keys.map((k) => ['exists', k]))
        .exec();

      const pipeline = this.redis.pipeline();
      const dbFallback: typeof items = [];

      await Promise.all(
        items.map(async (item, i) => {
          const exists = existsResults?.[i]?.[1];
          if (exists === 1) return;
          try {
            const record = await this.dailyTotalsService.findByUserAndDevice(
              item.userId,
              item.deviceId,
              date,
            );
            if (record && !record.autoCalculate) {
              pipeline.hsetnx(keys[i], 'totalA', String(record.totalA || 0));
              pipeline.hsetnx(keys[i], 'totalA2', String(record.totalA2 || 0));
            }
          } catch {
            // Can't read today's value: don't risk overwriting it later with
            // a Redis total that started from 0 — write this one to Mongo.
            dbFallback.push(item);
          }
        }),
      );

      items.forEach((item, i) => {
        if (dbFallback.includes(item)) return;
        const dirtyKey = this.getDirtyKey(item.userId, item.deviceId, date);
        pipeline.hincrbyfloat(keys[i], 'totalA', item.totalA);
        pipeline.hincrbyfloat(keys[i], 'totalA2', item.totalA2);
        pipeline.expire(keys[i], 7 * 24 * 3600);
        pipeline.sadd(this.DIRTY_SET_KEY, dirtyKey);
      });

      // Set expiry for dirty set once
      pipeline.expire(this.DIRTY_SET_KEY, 7 * 24 * 3600);

      await pipeline.exec();

      if (dbFallback.length > 0) {
        await this.incrementInDatabase(dbFallback, date);
      }
    } catch {
      // Redis pipeline error - silent
    }
  }

  // Fallback when Redis can't be used: atomic $inc on today's Mongo record.
  private async incrementInDatabase(
    items: Array<{
      userId: string;
      deviceId: string;
      totalA: number;
      totalA2: number;
    }>,
    date: string,
  ): Promise<void> {
    await Promise.allSettled(
      items.map((item) =>
        this.dailyTotalsService.incrementTotals(
          item.userId,
          item.deviceId,
          date,
          item.totalA,
          item.totalA2,
        ),
      ),
    );
  }

  async incrementDailyTotals(
    userId: string,
    deviceId: string,
    totalAIncrement: number,
    totalA2Increment: number,
  ): Promise<{ totalA: number; totalA2: number }> {
    // Skip if shutting down to prevent blocking
    if (this.isShuttingDown) {
      return { totalA: 0, totalA2: 0 };
    }
    try {
      if (!this.redis || this.redis.status !== 'ready') {
        // console.warn('Redis not available, falling back to database increment');
        const date = this.getGMT7Date();

        // Add timeout to prevent blocking
        const dbOperation = Promise.race([
          this.dailyTotalsService.incrementTotals(
            userId,
            deviceId,
            date,
            totalAIncrement,
            totalA2Increment,
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database timeout')), 3000),
          ),
        ]);

        await dbOperation;

        // Return current totals from database with timeout
        const recordPromise = Promise.race([
          this.dailyTotalsService.findByUserAndDevice(userId, deviceId, date),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database timeout')), 2000),
          ),
        ]);

        const record = (await recordPromise) as any;
        return { totalA: record?.totalA || 0, totalA2: record?.totalA2 || 0 };
      }

      const date = this.getGMT7Date();

      // Note: checkForNewDay() is called by timer every 10 minutes (line 79-81)
      // Removed from hot path to reduce CPU usage

      const redisKey = this.getRedisKey(userId, deviceId, date);
      const dirtyKey = this.getDirtyKey(userId, deviceId, date);

      // Use Redis pipeline with HINCRBYFLOAT for atomic increment (faster than get+set)
      const pipeline = this.redis.pipeline();
      pipeline.hincrbyfloat(redisKey, 'totalA', totalAIncrement);
      pipeline.hincrbyfloat(redisKey, 'totalA2', totalA2Increment);
      pipeline.expire(redisKey, 7 * 24 * 3600);
      pipeline.sadd(this.DIRTY_SET_KEY, dirtyKey);
      pipeline.expire(this.DIRTY_SET_KEY, 7 * 24 * 3600);

      const results = await pipeline.exec();

      // Return new totals from HINCRBYFLOAT results
      const newTotalA = (results?.[0]?.[1] as number) || 0;
      const newTotalA2 = (results?.[1]?.[1] as number) || 0;

      return { totalA: newTotalA, totalA2: newTotalA2 };
    } catch {
      const date = this.getGMT7Date();
      await this.dailyTotalsService.incrementTotals(
        userId,
        deviceId,
        date,
        totalAIncrement,
        totalA2Increment,
      );
      const record = await this.dailyTotalsService.findByUserAndDevice(
        userId,
        deviceId,
        date,
      );
      return { totalA: record?.totalA || 0, totalA2: record?.totalA2 || 0 };
    }
  }

  async getDailyTotals(
    userId: string,
    deviceId: string,
    date?: string,
  ): Promise<{ totalA: number; totalA2: number } | null> {
    const targetDate = date || this.getGMT7Date();

    try {
      if (!this.redis || this.redis.status !== 'ready') {
        const db = await this.getDailyValueFromDb(userId, deviceId, targetDate);
        return db ? { totalA: db.totalA, totalA2: db.totalA2 } : null;
      }

      const redisKey = this.getRedisKey(userId, deviceId, targetDate);
      const result = await this.redis.hmget(redisKey, 'totalA', 'totalA2');

      // A Redis hit is always a non-autoCalculate device (autoCalculate devices
      // upsert straight to Mongo and never touch Redis), so the raw value here
      // is already the correct daily value.
      if (result[0] || result[1]) {
        return {
          totalA: parseFloat(result[0] || '0'),
          totalA2: parseFloat(result[1] || '0'),
        };
      }

      // Redis miss: either a non-auto device with no traffic yet, or an
      // autoCalculate device that lives only in Mongo. Resolve from the DB with
      // the delta applied.
      const db = await this.getDailyValueFromDb(userId, deviceId, targetDate);
      if (!db) return null;

      // Warm the Redis cache only for non-auto devices. Caching an auto value
      // would serve the wrong number and could later be flushed back over the
      // cumulative counter in Mongo.
      if (!db.autoCalculate) {
        try {
          // HSETNX: never overwrite increments that landed after the read.
          await this.redis
            .pipeline()
            .hsetnx(redisKey, 'totalA', db.totalA.toString())
            .hsetnx(redisKey, 'totalA2', db.totalA2.toString())
            .exec();
          await this.redis.expire(redisKey, 7 * 24 * 3600);
        } catch {
          // Failed to cache data in Redis - silent
        }
      }

      return { totalA: db.totalA, totalA2: db.totalA2 };
    } catch {
      const db = await this.getDailyValueFromDb(userId, deviceId, targetDate);
      return db ? { totalA: db.totalA, totalA2: db.totalA2 } : null;
    }
  }

  async flushDirtyRecordsToDatabase(): Promise<void> {
    try {
      // Get all dirty keys
      const dirtyKeys = await this.redis.smembers(this.DIRTY_SET_KEY);

      if (dirtyKeys.length === 0) {
        return;
      }
      // Process in smaller batches to reduce CPU spikes
      const batchSize = 5; // Reduced from 10
      const batches: string[][] = [];

      for (let i = 0; i < dirtyKeys.length; i += batchSize) {
        batches.push(dirtyKeys.slice(i, i + batchSize));
      }

      // Process batches sequentially with small delays to reduce CPU load
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchPromises = batch.map(async (dirtyKey: string) => {
          try {
            const [userId, deviceId, date] = dirtyKey.split(':');
            const redisKey = this.getRedisKey(userId, deviceId, date);

            // Get current totals from Redis
            const result = await this.redis.hmget(
              redisKey,
              'totalA',
              'totalA2',
            );

            if (result[0] || result[1]) {
              const totalA = parseFloat(result[0] || '0');
              const totalA2 = parseFloat(result[1] || '0');

              // Update database
              await this.dailyTotalsService.upsertByUserAndDevice(
                userId,
                deviceId,
                date,
                totalA,
                totalA2,
              );

              // Remove from dirty set after successful write
              await this.redis.srem(this.DIRTY_SET_KEY, dirtyKey);
            } else {
              // Hash already gone (previous day saved & deleted, or expired):
              // nothing to flush, drop the stale dirty entry.
              await this.redis.srem(this.DIRTY_SET_KEY, dirtyKey);
            }
          } catch {
            // Error flushing record - silent
          }
        });

        await Promise.allSettled(batchPromises);

        // Add small delay between batches to prevent CPU spikes
        if (i < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    } catch {
      // Error flushing dirty records to database - silent
    }
  }

  async getTotalsByDateRange(
    userId: string,
    deviceId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    totalA: number;
    totalA2: number;
    count: number;
  }> {
    // For range queries, fallback to database as Redis is optimized for single-day operations
    const result = await this.dailyTotalsService.getTotalsByDateRange(
      userId,
      deviceId,
      startDate,
      endDate,
    );

    return {
      totalA: result.totalA,
      totalA2: result.totalA2,
      count: result.count,
    };
  }

  // Manual flush method for testing or immediate persistence
  async forceFlushToDatabase(): Promise<void> {
    await this.flushDirtyRecordsToDatabase();
  }

  private async checkForNewDay(): Promise<void> {
    const today = this.getGMT7Date();

    if (this.currentDay && this.currentDay !== today) {
      // Save previous day's data to database before reset
      await this.savePreviousDayData(this.currentDay);

      // Reset all today's totals to zero
      await this.resetDailyTotals(today);

      // Update current day
      this.currentDay = today;
    } else if (!this.currentDay) {
      this.currentDay = today;
    }
  }

  private async savePreviousDayData(previousDay: string): Promise<void> {
    try {
      // Get all keys for the previous day using SCAN instead of KEYS
      const pattern = `${this.KEY_PREFIX}:*:*:${previousDay}`;
      const keys = await this.scanKeys(pattern);

      for (const key of keys) {
        const keyParts = key.split(':');
        if (keyParts.length >= 4) {
          const userId = keyParts[1];
          const deviceId = keyParts[2];

          // Get totals from Redis
          const result = await this.redis.hmget(key, 'totalA', 'totalA2');

          if (result[0] || result[1]) {
            const totalA = parseFloat(result[0] || '0');
            const totalA2 = parseFloat(result[1] || '0');

            // Save to database
            await this.dailyTotalsService.upsertByUserAndDevice(
              userId,
              deviceId,
              previousDay,
              totalA,
              totalA2,
            );
          }
        }
      }

      // Clean up previous day's Redis keys in batches
      if (keys.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          await this.redis.del(...batch);
        }
      }
    } catch (error) {}
  }

  // Called when the GMT+7 day changes. The previous day's totals were already
  // saved to Mongo by savePreviousDayData(); here we only drop the previous
  // day's entries from the dirty set.
  //
  // IMPORTANT: this must NOT delete the new day's keys or the whole dirty set.
  // The check runs every 10 minutes (and once per cluster instance), so by the
  // time it runs the new day already holds real increments (totalA2 = grid
  // import, which happens at night) — deleting them loses that energy.
  private async resetDailyTotals(newDay: string): Promise<void> {
    try {
      const dirtyKeys = await this.redis.smembers(this.DIRTY_SET_KEY);
      const stale = dirtyKeys.filter((k) => !k.endsWith(`:${newDay}`));
      if (stale.length > 0) {
        await this.redis.srem(this.DIRTY_SET_KEY, ...stale);
      }
    } catch {
      // Error resetting daily totals - silent
    }
  }

  // Manual reset method for testing
  async manualDailyReset(): Promise<void> {
    const yesterday = this.getGMT7Date(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const today = this.getGMT7Date();

    await this.savePreviousDayData(yesterday);
    await this.resetDailyTotals(today);
    this.currentDay = today;
  }

  // Get today's totals from Redis (fast)
  async getTodaysTotals(
    userId: string,
    deviceId?: string,
  ): Promise<
    Array<{
      deviceId: string;
      totalA: number;
      totalA2: number;
    }>
  > {
    const today = this.getGMT7Date();
    const results: Array<{
      deviceId: string;
      totalA: number;
      totalA2: number;
    }> = [];

    if (deviceId) {
      // Get specific device
      const totals = await this.getDailyTotals(userId, deviceId, today);
      if (totals) {
        results.push({ deviceId, ...totals });
      }
    } else {
      // Get all devices for user (from Redis pattern)
      const pattern = `${this.KEY_PREFIX}:${userId}:*:${today}`;
      const keys = await this.scanKeys(pattern);

      for (const key of keys) {
        const keyParts = key.split(':');
        if (keyParts.length >= 4) {
          const deviceId = keyParts[2];
          const result = await this.redis.hmget(key, 'totalA', 'totalA2');

          if (result[0] || result[1]) {
            results.push({
              deviceId,
              totalA: parseFloat(result[0] || '0'),
              totalA2: parseFloat(result[1] || '0'),
            });
          }
        }
      }

      // autoCalculate devices never live in Redis (they upsert straight to
      // Mongo), so the scan above misses them. Pull them from the DB with the
      // delta applied and merge them in. No double-counting: non-auto devices
      // are excluded here and covered by the Redis scan.
      try {
        const dbRecords = await this.dailyTotalsService.getDailyTotalsByDay(
          userId,
          undefined,
          today,
        );
        const autoByDevice = new Map<
          string,
          { totalA: number; totalA2: number }
        >();
        for (const r of dbRecords) {
          if ((r as { autoCalculate?: boolean }).autoCalculate !== true) {
            continue;
          }
          const cur = autoByDevice.get(r.deviceId) || { totalA: 0, totalA2: 0 };
          cur.totalA += r.totalA;
          cur.totalA2 += r.totalA2;
          autoByDevice.set(r.deviceId, cur);
        }
        for (const [devId, totals] of autoByDevice) {
          results.push({ deviceId: devId, ...totals });
        }
      } catch {
        // Failed to merge autoCalculate devices - silent
      }
    }

    return results;
  }

  // Redis health check - runs every 30 seconds
  private async checkRedisHealth(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Redis ping timeout')), 2000),
        ),
      ]);

      if (pong === 'PONG') {
        this.redisHealthy = true;
        this.redisFailCount = 0;
        this.lastHealthCheck = new Date();
      }
    } catch {
      this.redisFailCount++;
      this.redisHealthy = false;
    }
  }

  // Get Redis connection info for debugging
  async getRedisInfo(): Promise<any> {
    let keyCount = 0;
    let dirtyKeys = 0;
    let pingLatency = -1;

    try {
      const start = Date.now();
      await this.redis.ping();
      pingLatency = Date.now() - start;

      keyCount = await this.redis.dbsize();
      dirtyKeys = await this.redis.scard(this.DIRTY_SET_KEY);
    } catch {
      // Redis not available
    }

    return {
      status: this.redis?.status || 'disconnected',
      healthy: this.redisHealthy,
      failCount: this.redisFailCount,
      lastHealthCheck: this.lastHealthCheck?.toISOString() || null,
      pingLatencyMs: pingLatency,
      keyCount,
      dirtyKeys,
      currentDay: this.currentDay,
      nextResetTime: this.getNextMidnightGMT7(),
    };
  }

  private getNextMidnightGMT7(): string {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);

    // Set to next midnight
    gmt7.setHours(24, 0, 0, 0);

    return gmt7.toISOString();
  }

  // Optimized key scanning method to replace redis.keys()
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      try {
        const result = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = result[0];
        keys.push(...result[1]);
      } catch {
        break;
      }
    } while (cursor !== '0');

    return keys;
  }
}
