/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Decimal } from 'decimal.js';
import { RedisConfig } from '../config/redis.config';
import { DailyTotalsService } from './daily-totals.service';

@Injectable()
export class RedisDailyTotalsService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private batchFlushTimer: NodeJS.Timeout;
  private dailyResetTimer: NodeJS.Timeout;
  private readonly BATCH_FLUSH_INTERVAL = 60000; // 60 seconds (1 minute)
  private readonly KEY_PREFIX = 'daily_totals';
  private readonly DIRTY_SET_KEY = 'daily_totals:dirty';
  private readonly PREVIOUS_DAY_KEY = 'daily_totals:previous_day';
  private currentDay: string;

  constructor(
    private redisConfig: RedisConfig,
    private dailyTotalsService: DailyTotalsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.redis = this.redisConfig.createRedisClient();

      // Add error handling for Redis connection
      this.redis.on('error', (error) => {
      });

      this.redis.on('connect', () => {
      });

      this.redis.on('ready', () => {
      });

      // Initialize current day
      this.currentDay = this.getGMT7Date();

      // Wait for Redis to be ready with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn('Redis connection timeout, continuing without Redis...');
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
            console.warn('Redis connection failed, continuing without Redis...');
            resolve();
          });
        }
      });

      // Start batch flush timer
      this.batchFlushTimer = setInterval(() => {
        void this.flushDirtyRecordsToDatabase();
      }, this.BATCH_FLUSH_INTERVAL);

      // Start daily reset timer (check every minute for new day)
      this.dailyResetTimer = setInterval(() => {
        void this.checkForNewDay();
      }, 60000); // Check every minute

    } catch (error) {
      console.error('Failed to initialize Redis Daily Totals Service:', error);
    }
  }

  async onModuleDestroy() {
    if (this.batchFlushTimer) {
      clearInterval(this.batchFlushTimer);
    }

    if (this.dailyResetTimer) {
      clearInterval(this.dailyResetTimer);
    }

    // Flush any remaining dirty records before shutdown
    await this.flushDirtyRecordsToDatabase();

    if (this.redis) {
      await this.redis.quit();
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

  async incrementDailyTotals(
    userId: string,
    deviceId: string,
    totalAIncrement: number,
    totalA2Increment: number,
  ): Promise<{ totalA: number; totalA2: number }> {
    try {
      if (!this.redis || this.redis.status !== 'ready') {
        console.warn('Redis not available, falling back to database increment');
        const date = this.getGMT7Date();
        await this.dailyTotalsService.incrementTotals(
          userId,
          deviceId,
          date,
          totalAIncrement,
          totalA2Increment,
        );
        // Return current totals from database
        const record = await this.dailyTotalsService.findByUserAndDevice(userId, deviceId, date);
        return { totalA: record?.totalA || 0, totalA2: record?.totalA2 || 0 };
      }

      const date = this.getGMT7Date();

      // Check if it's a new day and reset if needed
      await this.checkForNewDay();

      const redisKey = this.getRedisKey(userId, deviceId, date);
      const dirtyKey = this.getDirtyKey(userId, deviceId, date);

      // Get current values first to avoid floating point errors in Redis
      const currentValues = await this.redis.hmget(redisKey, 'totalA', 'totalA2');
      const currentTotalA = new Decimal(currentValues[0] || '0');
      const currentTotalA2 = new Decimal(currentValues[1] || '0');

      // Calculate new totals using decimal.js for precision
      const newTotalA = currentTotalA.plus(totalAIncrement);
      const newTotalA2 = currentTotalA2.plus(totalA2Increment);

      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Set new totals (not increment to avoid floating point errors)
      pipeline.hset(redisKey, {
        totalA: newTotalA.toString(),
        totalA2: newTotalA2.toString(),
      });

      // Set expiration (keep data for 7 days)
      pipeline.expire(redisKey, 7 * 24 * 3600);

      // Mark as dirty for batch writing to database
      pipeline.sadd(this.DIRTY_SET_KEY, dirtyKey);
      pipeline.expire(this.DIRTY_SET_KEY, 7 * 24 * 3600);

      // Execute all operations atomically
      await pipeline.exec();

      // Return new totals as numbers
      return {
        totalA: newTotalA.toNumber(),
        totalA2: newTotalA2.toNumber()
      };
    } catch (error) {
      console.error('Redis increment failed, falling back to database:', error);
      const date = this.getGMT7Date();
      await this.dailyTotalsService.incrementTotals(
        userId,
        deviceId,
        date,
        totalAIncrement,
        totalA2Increment,
      );
      const record = await this.dailyTotalsService.findByUserAndDevice(userId, deviceId, date);
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
        console.warn('Redis not available, falling back to database query');
        const dbRecord = await this.dailyTotalsService.findByUserAndDevice(
          userId,
          deviceId,
          targetDate,
        );
        return dbRecord ? { totalA: dbRecord.totalA, totalA2: dbRecord.totalA2 } : null;
      }

      const redisKey = this.getRedisKey(userId, deviceId, targetDate);
      const result = await this.redis.hmget(redisKey, 'totalA', 'totalA2');

      if (!result[0] && !result[1]) {
        // Try to load from database if not in cache
        const dbRecord = await this.dailyTotalsService.findByUserAndDevice(
          userId,
          deviceId,
          targetDate,
        );

        if (dbRecord) {
          // Load into Redis cache
          try {
            await this.redis.hset(redisKey, {
              totalA: dbRecord.totalA.toString(),
              totalA2: dbRecord.totalA2.toString(),
            });
            await this.redis.expire(redisKey, 7 * 24 * 3600);
          } catch (cacheError) {
            console.warn('Failed to cache data in Redis:', cacheError);
          }

          return { totalA: dbRecord.totalA, totalA2: dbRecord.totalA2 };
        }

        return null;
      }

      return {
        totalA: parseFloat(result[0] || '0'),
        totalA2: parseFloat(result[1] || '0'),
      };
    } catch (error) {
      console.error('Redis query failed, falling back to database:', error);
      const dbRecord = await this.dailyTotalsService.findByUserAndDevice(
        userId,
        deviceId,
        targetDate,
      );
      return dbRecord ? { totalA: dbRecord.totalA, totalA2: dbRecord.totalA2 } : null;
    }
  }

  async flushDirtyRecordsToDatabase(): Promise<void> {
    try {
      // Get all dirty keys
      const dirtyKeys = await this.redis.smembers(this.DIRTY_SET_KEY);

      if (dirtyKeys.length === 0) {
        return;
      }
      // Process in batches to avoid overwhelming the database
      const batchSize = 10;
      const batches: string[][] = [];

      for (let i = 0; i < dirtyKeys.length; i += batchSize) {
        batches.push(dirtyKeys.slice(i, i + batchSize));
      }

      for (const batch of batches) {
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
            }
          } catch (error) {
            console.error(`Error flushing record ${dirtyKey}:`, error);
          }
        });

        await Promise.allSettled(batchPromises);
      }
    } catch (error) {
      console.error('Error flushing dirty records to database:', error);
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

      // Get all keys for the previous day
      const pattern = `${this.KEY_PREFIX}:*:*:${previousDay}`;
      const keys = await this.redis.keys(pattern);

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

      // Clean up previous day's Redis keys
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      
    }
  }

  private async resetDailyTotals(newDay: string): Promise<void> {
    try {
      // Clear dirty set for the new day
      await this.redis.del(this.DIRTY_SET_KEY);

      // Get all Redis keys for the new day (should be empty, but clean up just in case)
      const newDayPattern = `${this.KEY_PREFIX}:*:*:${newDay}`;
      const newDayKeys = await this.redis.keys(newDayPattern);

      if (newDayKeys.length > 0) {
        await this.redis.del(...newDayKeys);
      }

    } catch (error) {
      console.error('Error resetting daily totals:', error);
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
  ): Promise<Array<{
    deviceId: string;
    totalA: number;
    totalA2: number;
  }>> {
    const today = this.getGMT7Date();
    const results: Array<{ deviceId: string; totalA: number; totalA2: number }> = [];

    if (deviceId) {
      // Get specific device
      const totals = await this.getDailyTotals(userId, deviceId, today);
      if (totals) {
        results.push({ deviceId, ...totals });
      }
    } else {
      // Get all devices for user (from Redis pattern)
      const pattern = `${this.KEY_PREFIX}:${userId}:*:${today}`;
      const keys = await this.redis.keys(pattern);

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
    }

    return results;
  }

  // Get Redis connection info for debugging
  async getRedisInfo(): Promise<any> {
    return {
      status: this.redis.status,
      keyCount: await this.redis.dbsize(),
      dirtyKeys: await this.redis.scard(this.DIRTY_SET_KEY),
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
}
