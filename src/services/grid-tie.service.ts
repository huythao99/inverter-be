import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisConfig } from '../config/redis.config';
import { InverterSetting } from '../models/inverter-setting.schema';
import { InverterSettingService } from './inverter-setting.service';
import type { AuditContext } from '../utils/audit-context';

export type GridTieStatus = 'on' | 'off';

/**
 * Grid-tie ("hoà lưới") on/off status per device.
 *
 * Source of truth is the `gridTieOff` flag on InverterSetting (MongoDB); this
 * service keeps a read-through Redis cache in front of it for fast firmware
 * polls. The flag is a status only - it never overwrites the device's saved
 * setting/schedule value. When grid-tie is OFF the GET setting/schedule
 * endpoints report GRID_TIE_OFF_VALUE while the real value stays intact.
 */
@Injectable()
export class GridTieService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly KEY_PREFIX = 'grid_tie';
  private readonly CACHE_TTL_SECONDS = 300; // 5 min; refreshed on every toggle

  constructor(
    private redisConfig: RedisConfig,
    private inverterSettingService: InverterSettingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis = this.redisConfig.createRedisClient();
    this.redis.on('error', () => {
      // Redis errors are handled gracefully by falling back to MongoDB.
    });
    await this.redis.connect().catch(() => {
      // Failed initial connect - isOff() falls back to the DB.
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // Ignore shutdown errors.
    }
  }

  private getKey(userId: string, deviceId: string): string {
    return `${this.KEY_PREFIX}:${userId}:${deviceId}`;
  }

  /**
   * Whether grid-tie is currently OFF. Read-through: Redis first, then MongoDB
   * (source of truth) on a cache miss or any Redis failure.
   */
  async isOff(userId: string, deviceId: string): Promise<boolean> {
    const key = this.getKey(userId, deviceId);

    try {
      const cached = await this.redis.get(key);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch {
      // Redis down - fall through to the DB below.
    }

    const off = await this.inverterSettingService.getGridTieOffFromDb(
      userId,
      deviceId,
    );
    await this.writeCache(key, off);
    return off;
  }

  async getStatus(userId: string, deviceId: string): Promise<GridTieStatus> {
    return (await this.isOff(userId, deviceId)) ? 'off' : 'on';
  }

  /**
   * Refresh Redis FIRST, then persist to MongoDB (source of truth).
   *
   * Order matters: setGridTieOffInDb() publishes cmd/settings + cmd/schedule
   * and the device re-fetches within ~100 ms. If Redis still held the old
   * status, GET setting/schedule (isOff) answered with the stale state - e.g.
   * the OFF value right after turning grid-tie back ON, which the firmware
   * then cached as its setting and kept running (99.00 V / 1 W).
   * If the DB write fails the cache entry is dropped (next read -> DB).
   */
  async setGridTie(
    userId: string,
    deviceId: string,
    off: boolean,
    ctx?: AuditContext,
  ): Promise<InverterSetting | null> {
    const key = this.getKey(userId, deviceId);
    await this.writeCache(key, off);
    try {
      return await this.inverterSettingService.setGridTieOffInDb(
        userId,
        deviceId,
        off,
        ctx,
      );
    } catch (e) {
      try {
        await this.redis.del(key);
      } catch {
        // Redis down: isOff() falls back to the DB anyway.
      }
      throw e;
    }
  }

  private async writeCache(key: string, off: boolean): Promise<void> {
    try {
      await this.redis.set(key, off ? '1' : '0', 'EX', this.CACHE_TTL_SECONDS);
    } catch {
      // Best-effort cache write; MongoDB remains the source of truth.
    }
  }
}
