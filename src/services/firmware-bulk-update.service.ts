import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RedisConfig } from '../config/redis.config';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import { MqttService } from './mqtt.service';
import { BulkFirmwareUpdateDto } from '../dto/bulk-firmware-update.dto';

type DeviceState =
  | 'queued' // waiting for its batch
  | 'sent' // trigger published, no OTA status yet
  | 'in_progress' // device reported starting / downloading
  | 'success'
  | 'failed';

export interface BulkJobStatus {
  jobId: string;
  status: 'sending' | 'sent';
  createdAt: string;
  sendingFinishedAt: string | null;
  total: number;
  counts: Record<DeviceState, number>;
  /** Devices that failed or have not answered yet (capped list). */
  failed: string[];
  noResponse: string[];
}

/**
 * Force firmware (OTA) update on many inverters from the CMS.
 *
 * - Triggers are published in small batches (BATCH_SIZE every BATCH_INTERVAL)
 *   so hundreds of devices don't download the firmware at the same moment.
 * - The trigger is the same non-retained `firmware/update` message as the
 *   single-device update: devices that are offline at that moment miss it
 *   (a retained trigger would re-flash on every reconnect with the current
 *   firmware — see MQTT_RETAIN_NOTES.md). Re-run the job for those later.
 * - Progress is tracked from the devices' `ota/status` reports and kept in
 *   Redis, so any instance can serve the status and the job survives page
 *   reloads (state expires after JOB_TTL_SECONDS).
 */
@Injectable()
export class FirmwareBulkUpdateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirmwareBulkUpdateService.name);
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_INTERVAL_MS = 10000;
  private readonly MAX_DEVICES = 5000;
  private readonly JOB_TTL_SECONDS = 24 * 3600;
  private readonly ACTIVE_TTL_SECONDS = 2 * 3600;
  private readonly LIST_LIMIT = 200;
  private readonly KEY = 'fw_bulk';
  private redis: Redis;

  constructor(
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    private redisConfig: RedisConfig,
    private mqttService: MqttService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis = this.redisConfig.createRedisClient();
    this.redis.on('error', () => {
      // Reported per request (503) instead.
    });
    await this.redis.connect().catch(() => {
      // Redis down at boot - requests will fail with 503 until it's back.
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {
      // Ignore.
    }
  }

  private jobKey(jobId: string) {
    return `${this.KEY}:job:${jobId}`;
  }
  private devKey(jobId: string) {
    return `${this.KEY}:job:${jobId}:dev`;
  }
  private activeKey(device: string) {
    return `${this.KEY}:active:${device}`;
  }
  private get latestKey() {
    return `${this.KEY}:latest`;
  }

  private ensureRedis(): void {
    if (this.redis?.status !== 'ready') {
      throw new ServiceUnavailableException(
        'Redis is not available, cannot run a bulk update right now',
      );
    }
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async start(dto: BulkFirmwareUpdateDto): Promise<BulkJobStatus> {
    this.ensureRedis();
    if (!this.mqttService.isConnected()) {
      throw new ServiceUnavailableException('MQTT broker is not connected');
    }

    // One job at a time: two overlapping jobs would double-trigger devices.
    const latest = await this.redis.get(this.latestKey);
    if (latest) {
      const state = await this.redis.hget(this.jobKey(latest), 'status');
      if (state === 'sending') {
        throw new ConflictException(
          'Another bulk update is still sending triggers, wait for it to finish',
        );
      }
    }

    const filter: Record<string, unknown> = {};
    if (dto.all) {
      const search = dto.search?.trim();
      if (search) {
        const re = { $regex: this.escapeRegex(search), $options: 'i' };
        filter.$or = [{ deviceId: re }, { deviceName: re }, { userId: re }];
      }
    } else if (dto.ids && dto.ids.length > 0) {
      filter._id = { $in: dto.ids };
    } else {
      throw new BadRequestException('Select at least one device');
    }

    const devices = await this.inverterDeviceModel
      .find(filter, { userId: 1, deviceId: 1 })
      .sort({ updatedAt: -1 })
      .limit(this.MAX_DEVICES + 1)
      .lean()
      .exec();
    if (devices.length === 0) {
      throw new NotFoundException('No matching devices');
    }
    if (devices.length > this.MAX_DEVICES) {
      throw new BadRequestException(
        `Too many devices (> ${this.MAX_DEVICES}), narrow the filter`,
      );
    }

    const jobId = randomUUID();
    const targets = devices.map((d) => `${d.userId}/${d.deviceId}`);
    const createdAt = new Date().toISOString();

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.jobKey(jobId), {
      status: 'sending',
      createdAt,
      total: String(targets.length),
      sendingFinishedAt: '',
    });
    for (let i = 0; i < targets.length; i += 500) {
      const chunk: Record<string, string> = {};
      for (const t of targets.slice(i, i + 500)) chunk[t] = 'queued';
      pipeline.hset(this.devKey(jobId), chunk);
    }
    pipeline.expire(this.jobKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.expire(this.devKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.set(this.latestKey, jobId, 'EX', this.JOB_TTL_SECONDS);
    await pipeline.exec();

    this.logger.log(
      `Bulk firmware update ${jobId}: ${targets.length} device(s)`,
    );
    void this.runBatches(jobId, targets);

    return this.getStatus(jobId);
  }

  /** Publish triggers batch by batch (runs in the background). */
  private async runBatches(jobId: string, targets: string[]): Promise<void> {
    try {
      for (let i = 0; i < targets.length; i += this.BATCH_SIZE) {
        const batch = targets.slice(i, i + this.BATCH_SIZE);
        for (const target of batch) {
          const [userId, deviceId] = target.split('/');
          try {
            await this.mqttService.publish(
              `inverter/${userId}/${deviceId}/firmware/update`,
              {
                action: 'start_update',
                userId,
                deviceId,
                force: true,
                bulkJobId: jobId,
                timestamp: new Date().toISOString(),
              },
            );
            await this.redis
              .pipeline()
              .hset(this.devKey(jobId), target, 'sent')
              .set(this.activeKey(target), jobId, 'EX', this.ACTIVE_TTL_SECONDS)
              .exec();
          } catch {
            await this.redis.hset(this.devKey(jobId), target, 'failed');
          }
        }
        if (i + this.BATCH_SIZE < targets.length) {
          await new Promise((r) => setTimeout(r, this.BATCH_INTERVAL_MS));
        }
      }
    } finally {
      await this.redis
        .hset(this.jobKey(jobId), {
          status: 'sent',
          sendingFinishedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
  }

  /** Track progress from the devices' OTA reports. */
  @OnEvent('ota.status.received')
  async handleOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
  }): Promise<void> {
    if (this.redis?.status !== 'ready' || !payload.status) return;
    const target = `${payload.userId}/${payload.deviceId}`;
    try {
      const jobId = await this.redis.get(this.activeKey(target));
      if (!jobId) return;

      let next: DeviceState;
      switch (payload.status) {
        case 'success':
          next = 'success';
          break;
        case 'failed':
          next = 'failed';
          break;
        default:
          next = 'in_progress'; // starting / downloading / installing
      }

      const prev = await this.redis.hget(this.devKey(jobId), target);
      if (prev === 'success') return; // never downgrade a finished device
      await this.redis.hset(this.devKey(jobId), target, next);
      if (next === 'success' || next === 'failed') {
        await this.redis.del(this.activeKey(target));
      }
    } catch {
      // Progress tracking is best-effort.
    }
  }

  async getLatest(): Promise<BulkJobStatus | null> {
    this.ensureRedis();
    const jobId = await this.redis.get(this.latestKey);
    return jobId ? this.getStatus(jobId) : null;
  }

  async getStatus(jobId: string): Promise<BulkJobStatus> {
    this.ensureRedis();
    const job = await this.redis.hgetall(this.jobKey(jobId));
    if (!job || !job.status) {
      throw new NotFoundException('Bulk update job not found or expired');
    }
    const devices = await this.redis.hgetall(this.devKey(jobId));

    const counts: Record<DeviceState, number> = {
      queued: 0,
      sent: 0,
      in_progress: 0,
      success: 0,
      failed: 0,
    };
    const failed: string[] = [];
    const noResponse: string[] = [];
    for (const [device, state] of Object.entries(devices)) {
      const s = state as DeviceState;
      if (s in counts) counts[s]++;
      if (s === 'failed' && failed.length < this.LIST_LIMIT) failed.push(device);
      if (s === 'sent' && noResponse.length < this.LIST_LIMIT) {
        noResponse.push(device);
      }
    }

    return {
      jobId,
      status: job.status === 'sending' ? 'sending' : 'sent',
      createdAt: job.createdAt,
      sendingFinishedAt: job.sendingFinishedAt || null,
      total: Number(job.total) || Object.keys(devices).length,
      counts,
      failed,
      noResponse,
    };
  }
}
