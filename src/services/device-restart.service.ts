import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RedisConfig } from '../config/redis.config';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import { MqttService } from './mqtt.service';

export type RestartSource = 'app' | 'web' | 'cms';

export interface RestartResult {
  message: string;
  requestId: string;
  userId: string;
  deviceId: string;
  requestedAt: string;
  cooldownSeconds: number;
}

/**
 * Remote reboot of an inverter ESP32.
 *
 * Publishes `inverter/{userId}/{deviceId}/cmd/restart` (QoS 1, NOT retained —
 * a retained restart would reboot the device again on every reconnect).
 * One request per device per COOLDOWN_SECONDS, shared by app, web and CMS, so
 * repeated taps can't keep a device in a reboot loop.
 */
@Injectable()
export class DeviceRestartService implements OnModuleInit, OnModuleDestroy {
  private readonly COOLDOWN_SECONDS = 60;
  private readonly KEY_PREFIX = 'device_restart';
  private redis: Redis;
  // Fallback when Redis is unavailable (per process only).
  private readonly localCooldown = new Map<string, number>();

  constructor(
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    private redisConfig: RedisConfig,
    private mqttService: MqttService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis = this.redisConfig.createRedisClient();
    this.redis.on('error', () => {
      // Handled by falling back to the in-memory cooldown.
    });
    await this.redis.connect().catch(() => {
      // Redis down at boot - in-memory cooldown is used.
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // Ignore shutdown errors.
    }
  }

  /** Restart a device identified by owner + deviceId (app / web). */
  async restartByUserAndDevice(
    userId: string,
    deviceId: string,
    source: RestartSource,
  ): Promise<RestartResult> {
    const device = await this.inverterDeviceModel
      .findOne({ userId, deviceId })
      .lean()
      .exec();
    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
    return this.send(userId, deviceId, source);
  }

  /** Restart a device identified by its MongoDB _id (CMS). */
  async restartById(id: string, source: RestartSource): Promise<RestartResult> {
    const device = await this.inverterDeviceModel.findById(id).lean().exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${id} not found`);
    }
    return this.send(device.userId, device.deviceId, source);
  }

  private async send(
    userId: string,
    deviceId: string,
    source: RestartSource,
  ): Promise<RestartResult> {
    if (!this.mqttService.isConnected()) {
      throw new HttpException(
        'Máy chủ MQTT đang mất kết nối, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const retryAfter = await this.acquireCooldown(userId, deviceId);
    if (retryAfter > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Thiết bị vừa được yêu cầu khởi động lại, vui lòng thử lại sau ${retryAfter} giây`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const requestId = randomUUID();
    const requestedAt = new Date();
    try {
      await this.mqttService.emitRestartDevice(userId, deviceId, {
        requestId,
        source,
        ts: requestedAt.getTime(),
      });
    } catch (error) {
      // Publish failed: release the cooldown so the user can retry at once.
      await this.releaseCooldown(userId, deviceId);
      throw error;
    }

    return {
      message: 'Đã gửi lệnh khởi động lại tới thiết bị',
      requestId,
      userId,
      deviceId,
      requestedAt: requestedAt.toISOString(),
      cooldownSeconds: this.COOLDOWN_SECONDS,
    };
  }

  private key(userId: string, deviceId: string): string {
    return `${this.KEY_PREFIX}:${userId}:${deviceId}`;
  }

  /** Returns 0 when acquired, otherwise the seconds left on the cooldown. */
  private async acquireCooldown(
    userId: string,
    deviceId: string,
  ): Promise<number> {
    const key = this.key(userId, deviceId);
    try {
      if (this.redis?.status === 'ready') {
        const ok = await this.redis.set(
          key,
          '1',
          'EX',
          this.COOLDOWN_SECONDS,
          'NX',
        );
        if (ok === 'OK') return 0;
        const ttl = await this.redis.ttl(key);
        return ttl > 0 ? ttl : this.COOLDOWN_SECONDS;
      }
    } catch {
      // Fall through to the in-memory cooldown.
    }

    const now = Date.now();
    const until = this.localCooldown.get(key) ?? 0;
    if (until > now) return Math.ceil((until - now) / 1000);
    this.localCooldown.set(key, now + this.COOLDOWN_SECONDS * 1000);
    if (this.localCooldown.size > 1000) {
      for (const [k, v] of this.localCooldown) {
        if (v <= now) this.localCooldown.delete(k);
      }
    }
    return 0;
  }

  private async releaseCooldown(
    userId: string,
    deviceId: string,
  ): Promise<void> {
    const key = this.key(userId, deviceId);
    this.localCooldown.delete(key);
    try {
      await this.redis?.del(key);
    } catch {
      // Ignore.
    }
  }
}
