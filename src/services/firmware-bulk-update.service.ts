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
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';
import { BulkFirmwareUpdateDto } from '../dto/bulk-firmware-update.dto';
import {
  StmFirmwareService,
  StmTarget,
  parseStmVersion,
  voltageLabel,
} from './stm-firmware.service';
import {
  newestFirmwareVersion,
  newestBetaFirmwareVersion,
  compareFirmwareVersions,
  isLegacyDevice,
  stableTargetFor,
  activeRollout,
  inActiveRollout,
} from './firmware.service';

type DeviceState =
  | 'queued' // waiting for its batch
  | 'sent' // trigger published, no OTA status yet
  | 'in_progress' // device reported starting / downloading
  | 'success'
  | 'failed'
  | 'skipped_uptodate' // not sent: already on the target version
  | 'skipped_beta' // not sent: on the beta list
  | 'skipped_legacy' // not sent: legacy device (number < 436), no OTA
  | 'skipped_unsupported' // STM32 job: ESP32 firmware too old for STM32 FOTA
  | 'skipped_nofw'; // STM32 job: STM32 version unknown / no image for its voltage

const DEVICE_STATES: DeviceState[] = [
  'queued',
  'sent',
  'in_progress',
  'success',
  'failed',
  'skipped_uptodate',
  'skipped_beta',
  'skipped_legacy',
  'skipped_unsupported',
  'skipped_nofw',
];

export type BulkTarget = 'esp32' | 'stm32';

/** Last known details of one device in a job (stored as JSON in Redis). */
interface DeviceInfo {
  /** Raw OTA status last reported by the device (starting, downloading...). */
  otaStatus?: string;
  progress?: number;
  message?: string;
  /** Firmware version the device reported when the job was created. */
  version?: string;
  /** ISO time of the last change. */
  at?: string;
}

export interface BulkJobDeviceRow extends DeviceInfo {
  userId: string;
  deviceId: string;
  state: DeviceState;
}

export interface BulkJobDevicesPage {
  jobId: string;
  state: DeviceState | 'all';
  total: number;
  page: number;
  limit: number;
  data: BulkJobDeviceRow[];
}

export interface BulkJobStatus {
  jobId: string;
  /** esp32 = ESP32 OTA, stm32 = STM32 FOTA through the ESP32. */
  target: BulkTarget;
  status: 'sending' | 'sent';
  createdAt: string;
  sendingFinishedAt: string | null;
  total: number;
  /** Firmware version the job targets. */
  targetVersion: string;
  /** Selected devices left out because they already run targetVersion. */
  skipped: number;
  /** Selected devices left out because they are on the beta list. */
  skippedBeta: number;
  /** Selected legacy devices (number < 436) left out: they never get OTA. */
  skippedLegacy: number;
  /** STM32 jobs: ESP32 firmware too old for STM32 FOTA. */
  skippedUnsupported: number;
  /** STM32 jobs: version not reported yet / no image for its voltage. */
  skippedNoFirmware: number;
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
export class FirmwareBulkUpdateService
  implements OnModuleInit, OnModuleDestroy
{
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
    private betaFirmwareDeviceService: BetaFirmwareDeviceService,
    private stmFirmwareService: StmFirmwareService,
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
  private infoKey(jobId: string) {
    return `${this.KEY}:job:${jobId}:info`;
  }
  private info(i: DeviceInfo): string {
    return JSON.stringify({ ...i, at: i.at ?? new Date().toISOString() });
  }
  private activeKey(device: string, target: BulkTarget = 'esp32') {
    return target === 'stm32'
      ? `${this.KEY}:active_stm:${device}`
      : `${this.KEY}:active:${device}`;
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
      .find(filter, {
        userId: 1,
        deviceId: 1,
        firmwareVersion: 1,
        stmFwVersion: 1,
        stmFwCrc: 1,
      })
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

    if (dto.target === 'stm32') {
      return this.startStm(dto, devices);
    }

    // Skip devices already on the newest firmware. The version is the one the
    // device itself PATCHes after every boot, so it is accurate after an OTA.
    // Devices with no reported version are kept (unknown = maybe outdated).
    // Beta devices are skipped first (they follow their own beta build, whose
    // version is unrelated to the stable version).
    // Legacy devices (number < 436) never get OTA: always skipped.
    // During a staged rollout the devices in it target the rollout build.
    const rollout = activeRollout();
    const targetVersion =
      rollout && devices.some((d) => inActiveRollout(d.deviceId))
        ? rollout.version
        : newestFirmwareVersion();
    const nonLegacy = devices.filter((d) => !isLegacyDevice(d.deviceId));
    const skippedLegacy = devices.length - nonLegacy.length;
    const nonBeta = dto.includeBeta
      ? nonLegacy
      : nonLegacy.filter(
          (d) => !this.betaFirmwareDeviceService.isBeta(d.deviceId, d.userId),
        );
    const skippedBeta = nonLegacy.length - nonBeta.length;
    // Each device is compared with the build it will actually download:
    // beta-list devices (only present with includeBeta) get the beta build.
    const versionFor = (d: { deviceId: string; userId: string }) =>
      this.betaFirmwareDeviceService.isBeta(d.deviceId, d.userId)
        ? newestBetaFirmwareVersion()
        : stableTargetFor(d.deviceId).version;
    const toUpdate = dto.includeUpToDate
      ? nonBeta
      : nonBeta.filter(
          (d) =>
            !d.firmwareVersion ||
            compareFirmwareVersions(d.firmwareVersion, versionFor(d)) < 0,
        );
    const skipped = nonBeta.length - toUpdate.length;
    if (toUpdate.length === 0) {
      const reasons: string[] = [];
      if (skipped > 0) reasons.push(`${skipped} already on ${targetVersion}`);
      if (skippedBeta > 0) reasons.push(`${skippedBeta} on the beta list`);
      if (skippedLegacy > 0) {
        reasons.push(`${skippedLegacy} legacy device(s) (number < 436)`);
      }
      throw new BadRequestException(`Nothing to update: ${reasons.join(', ')}`);
    }

    const jobId = randomUUID();
    const targets = toUpdate.map((d) => `${d.userId}/${d.deviceId}`);
    const createdAt = new Date().toISOString();

    const pipeline = this.redis.pipeline();
    pipeline.hset(this.jobKey(jobId), {
      status: 'sending',
      createdAt,
      total: String(targets.length),
      targetVersion,
      skipped: String(skipped),
      skippedBeta: String(skippedBeta),
      skippedLegacy: String(skippedLegacy),
      target: 'esp32',
      includeUpToDate: dto.includeUpToDate ? '1' : '',
      sendingFinishedAt: '',
    });
    // Every selected device gets a row (skipped ones too) so the CMS can list
    // exactly what happened to each of them.
    const toUpdateSet = new Set(toUpdate);
    const nonBetaSet = new Set(nonBeta);
    const nonLegacySet = new Set(nonLegacy);
    const rows = devices.map((d) => {
      const state: DeviceState = toUpdateSet.has(d)
        ? 'queued'
        : !nonLegacySet.has(d)
          ? 'skipped_legacy'
          : nonBetaSet.has(d)
            ? 'skipped_uptodate'
            : 'skipped_beta';
      return {
        target: `${d.userId}/${d.deviceId}`,
        state,
        info: this.info({
          version: d.firmwareVersion ?? undefined,
          at: createdAt,
        }),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const states: Record<string, string> = {};
      const infos: Record<string, string> = {};
      for (const r of rows.slice(i, i + 500)) {
        states[r.target] = r.state;
        infos[r.target] = r.info;
      }
      pipeline.hset(this.devKey(jobId), states);
      pipeline.hset(this.infoKey(jobId), infos);
    }
    pipeline.expire(this.jobKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.expire(this.devKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.expire(this.infoKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.set(this.latestKey, jobId, 'EX', this.JOB_TTL_SECONDS);
    await pipeline.exec();

    this.logger.log(
      `Bulk firmware update ${jobId} -> ${targetVersion}: ${targets.length} device(s), ${skipped} skipped (up to date), ${skippedBeta} skipped (beta), ${skippedLegacy} skipped (legacy)`,
    );
    void this.runBatches(jobId, targets);

    return this.getStatus(jobId);
  }

  /**
   * STM32 FOTA job. Every device gets the image of its own voltage class
   * (2nd number of the version its STM32 reports), so there is no single target version.
   */
  private async startStm(
    dto: BulkFirmwareUpdateDto,
    devices: Array<{
      userId: string;
      deviceId: string;
      firmwareVersion?: string | null;
      stmFwVersion?: string | null;
      stmFwCrc?: string | null;
    }>,
  ): Promise<BulkJobStatus> {
    const targetCache = new Map<string, StmTarget | null>();
    const counts = { unsupported: 0, beta: 0, nofw: 0, uptodate: 0 };
    const rows: { target: string; state: DeviceState; info: string }[] = [];
    const targets: string[] = [];
    const createdAt = new Date().toISOString();

    for (const d of devices) {
      const key = `${d.userId}/${d.deviceId}`;
      const beta = this.betaFirmwareDeviceService.isBeta(d.deviceId, d.userId);
      let state: DeviceState = 'queued';
      let note: string | undefined;
      let tgt: StmTarget | null = null;

      if (!this.stmFirmwareService.espSupportsStmFota(d.firmwareVersion)) {
        state = 'skipped_unsupported';
        counts.unsupported++;
        note = `ESP32 ${d.firmwareVersion ?? '?'} < ${this.stmFirmwareService.minEspVersion}`;
      } else if (beta && !dto.includeBeta) {
        state = 'skipped_beta';
        counts.beta++;
      } else if (!parseStmVersion(d.stmFwVersion)) {
        state = 'skipped_nofw';
        counts.nofw++;
        note = 'STM32 version not reported yet';
      } else {
        const cur = parseStmVersion(d.stmFwVersion)!;
        const code = cur.voltageCode;
        const cacheKey = `${cur.major}.${code}/${beta ? 'b' : 's'}`;
        if (!targetCache.has(cacheKey)) {
          targetCache.set(
            cacheKey,
            await this.stmFirmwareService.findTarget(
              'inverter',
              cur.major,
              code,
              beta,
            ),
          );
        }
        tgt = targetCache.get(cacheKey) ?? null;
        if (!tgt) {
          state = 'skipped_nofw';
          counts.nofw++;
          note = `No STM32 image for ${cur.major}.${code}.x (${voltageLabel(code)})`;
        } else if (
          !dto.includeUpToDate &&
          this.stmFirmwareService.isUpToDate(
            d as unknown as InverterDevice,
            tgt,
          )
        ) {
          state = 'skipped_uptodate';
          counts.uptodate++;
        }
      }
      if (state === 'queued') targets.push(key);
      rows.push({
        target: key,
        state,
        info: this.info({
          version: d.stmFwVersion ?? d.stmFwCrc ?? undefined,
          message:
            note ?? (tgt ? `${d.stmFwVersion} -> ${tgt.version}` : undefined),
          at: createdAt,
        }),
      });
    }

    if (targets.length === 0) {
      const reasons: string[] = [];
      if (counts.uptodate)
        reasons.push(`${counts.uptodate} already up to date`);
      if (counts.nofw)
        reasons.push(`${counts.nofw} without STM32 version/image`);
      if (counts.unsupported) {
        reasons.push(`${counts.unsupported} with ESP32 firmware too old`);
      }
      if (counts.beta) reasons.push(`${counts.beta} on the beta list`);
      throw new BadRequestException(`Nothing to update: ${reasons.join(', ')}`);
    }

    const jobId = randomUUID();
    const pipeline = this.redis.pipeline();
    pipeline.hset(this.jobKey(jobId), {
      status: 'sending',
      createdAt,
      total: String(targets.length),
      target: 'stm32',
      targetVersion: 'STM32 (per voltage)',
      skipped: String(counts.uptodate),
      skippedBeta: String(counts.beta),
      skippedLegacy: '0',
      skippedUnsupported: String(counts.unsupported),
      skippedNoFirmware: String(counts.nofw),
      sendingFinishedAt: '',
    });
    for (let i = 0; i < rows.length; i += 500) {
      const states: Record<string, string> = {};
      const infos: Record<string, string> = {};
      for (const r of rows.slice(i, i + 500)) {
        states[r.target] = r.state;
        infos[r.target] = r.info;
      }
      pipeline.hset(this.devKey(jobId), states);
      pipeline.hset(this.infoKey(jobId), infos);
    }
    pipeline.expire(this.jobKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.expire(this.devKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.expire(this.infoKey(jobId), this.JOB_TTL_SECONDS);
    pipeline.set(this.latestKey, jobId, 'EX', this.JOB_TTL_SECONDS);
    await pipeline.exec();

    this.logger.log(
      `Bulk STM32 update ${jobId}: ${targets.length} device(s), skipped: ${JSON.stringify(counts)}`,
    );
    void this.runBatches(jobId, targets, 'stm32');
    return this.getStatus(jobId);
  }

  /** True when the device's current target is not newer than its version. */
  private async targetNoLongerNewer(
    jobId: string,
    target: string,
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    try {
      // Re-flashing up-to-date devices was asked for explicitly.
      if (
        (await this.redis.hget(this.jobKey(jobId), 'includeUpToDate')) === '1'
      ) {
        return false;
      }
      const raw = await this.redis.hget(this.infoKey(jobId), target);
      const version = raw ? (JSON.parse(raw) as DeviceInfo).version : undefined;
      if (!version) return false;
      const want = this.betaFirmwareDeviceService.isBeta(deviceId, userId)
        ? newestBetaFirmwareVersion()
        : stableTargetFor(deviceId).version;
      return compareFirmwareVersions(version, want) >= 0;
    } catch {
      return false;
    }
  }

  /** Publish triggers batch by batch (runs in the background). */
  private async runBatches(
    jobId: string,
    targets: string[],
    kind: BulkTarget = 'esp32',
  ): Promise<void> {
    try {
      for (let i = 0; i < targets.length; i += this.BATCH_SIZE) {
        const batch = targets.slice(i, i + this.BATCH_SIZE);
        for (const target of batch) {
          const [userId, deviceId] = target.split('/');
          try {
            if (kind === 'stm32') {
              // Re-validates against the current device state and records
              // stmOta on the device (force: the job already skipped
              // up-to-date devices unless includeUpToDate was set).
              await this.stmFirmwareService.trigger(userId, deviceId, {
                force: true,
                source: 'bulk',
                skipCooldown: true,
              });
            } else {
              // The target can change while the job is sending (a staged
              // rollout paused/aborted): don't make a device re-flash the
              // version it already runs.
              if (
                await this.targetNoLongerNewer(jobId, target, userId, deviceId)
              ) {
                await this.redis
                  .pipeline()
                  .hset(this.devKey(jobId), target, 'skipped_uptodate')
                  .hset(
                    this.infoKey(jobId),
                    target,
                    await this.mergeInfo(jobId, target, {
                      message:
                        'Not sent: target changed (rollout paused/aborted)',
                    }),
                  )
                  .exec();
                continue;
              }
              await this.mqttService.publish(
                `inverter/${userId}/${deviceId}/firmware/update`,
                // Only { ts } - see UserApiController firmware/update.
                { ts: Date.now() },
              );
            }
            await this.redis
              .pipeline()
              .hset(this.devKey(jobId), target, 'sent')
              .hset(
                this.infoKey(jobId),
                target,
                await this.mergeInfo(jobId, target, {
                  message: 'Update command sent, waiting for the device',
                }),
              )
              .set(
                this.activeKey(target, kind),
                jobId,
                'EX',
                this.ACTIVE_TTL_SECONDS,
              )
              .exec();
          } catch (err) {
            const reason =
              kind === 'stm32' && err instanceof Error
                ? err.message.slice(0, 200)
                : 'Could not publish the MQTT command';
            await this.redis
              .pipeline()
              .hset(this.devKey(jobId), target, 'failed')
              .hset(
                this.infoKey(jobId),
                target,
                await this.mergeInfo(jobId, target, { message: reason }),
              )
              .exec()
              .catch(() => undefined);
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

  /** Merge new fields into a device's stored info JSON. */
  private async mergeInfo(
    jobId: string,
    target: string,
    patch: DeviceInfo,
  ): Promise<string> {
    let prev: DeviceInfo = {};
    try {
      const raw = await this.redis.hget(this.infoKey(jobId), target);
      if (raw) prev = JSON.parse(raw) as DeviceInfo;
    } catch {
      // Corrupt / missing: start fresh.
    }
    return this.info({ ...prev, ...patch, at: undefined });
  }

  /** Track progress from the devices' OTA reports. */
  @OnEvent('ota.status.received')
  async handleOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
    progress?: number;
    message?: string;
  }): Promise<void> {
    return this.applyStatus('esp32', payload);
  }

  /** Same for STM32 FOTA reports (inverter/{uid}/{id}/stm/ota/status). */
  @OnEvent('stm.ota.status.received')
  async handleStmOtaStatus(payload: {
    userId: string;
    deviceId: string;
    status?: string;
    progress?: number;
    message?: string;
  }): Promise<void> {
    return this.applyStatus('stm32', payload);
  }

  private async applyStatus(
    kind: BulkTarget,
    payload: {
      userId: string;
      deviceId: string;
      status?: string;
      progress?: number;
      message?: string;
    },
  ): Promise<void> {
    if (this.redis?.status !== 'ready' || !payload.status) return;
    const target = `${payload.userId}/${payload.deviceId}`;
    try {
      const jobId = await this.redis.get(this.activeKey(target, kind));
      if (!jobId) return;

      let next: DeviceState;
      switch (payload.status) {
        case 'success':
          next = 'success';
          break;
        case 'failed':
        case 'rescue_needed': // STM32 left in its bootloader
          next = 'failed';
          break;
        default:
          next = 'in_progress'; // starting / downloading / installing
      }

      const prev = await this.redis.hget(this.devKey(jobId), target);
      if (prev === 'success') return; // never downgrade a finished device
      const info = await this.mergeInfo(jobId, target, {
        otaStatus: payload.status,
        progress:
          typeof payload.progress === 'number' ? payload.progress : undefined,
        message:
          typeof payload.message === 'string'
            ? payload.message.slice(0, 200)
            : undefined,
      });
      await this.redis
        .pipeline()
        .hset(this.devKey(jobId), target, next)
        .hset(this.infoKey(jobId), target, info)
        .exec();
      if (next === 'success' || next === 'failed') {
        await this.redis.del(this.activeKey(target, kind));
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

    const counts = Object.fromEntries(
      DEVICE_STATES.map((st) => [st, 0]),
    ) as Record<DeviceState, number>;
    const failed: string[] = [];
    const noResponse: string[] = [];
    for (const [device, state] of Object.entries(devices)) {
      const s = state as DeviceState;
      if (s in counts) counts[s]++;
      if (s === 'failed' && failed.length < this.LIST_LIMIT)
        failed.push(device);
      if (s === 'sent' && noResponse.length < this.LIST_LIMIT) {
        noResponse.push(device);
      }
    }

    return {
      jobId,
      target: job.target === 'stm32' ? 'stm32' : 'esp32',
      status: job.status === 'sending' ? 'sending' : 'sent',
      createdAt: job.createdAt,
      sendingFinishedAt: job.sendingFinishedAt || null,
      total: Number(job.total) || Object.keys(devices).length,
      targetVersion: job.targetVersion || newestFirmwareVersion(),
      skipped: Number(job.skipped) || 0,
      skippedBeta: Number(job.skippedBeta) || 0,
      skippedLegacy: Number(job.skippedLegacy) || 0,
      skippedUnsupported: Number(job.skippedUnsupported) || 0,
      skippedNoFirmware: Number(job.skippedNoFirmware) || 0,
      counts,
      failed,
      noResponse,
    };
  }

  /** Per-device rows of a job, optionally filtered by state (paginated). */
  async getDevices(
    jobId: string,
    state: string | undefined,
    page = 1,
    limit = 50,
  ): Promise<BulkJobDevicesPage> {
    this.ensureRedis();
    const exists = await this.redis.exists(this.jobKey(jobId));
    if (!exists) {
      throw new NotFoundException('Bulk update job not found or expired');
    }
    const filter =
      state && (DEVICE_STATES as string[]).includes(state)
        ? (state as DeviceState)
        : 'all';
    const [states, infos] = await Promise.all([
      this.redis.hgetall(this.devKey(jobId)),
      this.redis.hgetall(this.infoKey(jobId)),
    ]);

    // Most actionable first: failed, no reply, updating, waiting, done, skipped.
    const order: Record<DeviceState, number> = {
      failed: 0,
      sent: 1,
      in_progress: 2,
      queued: 3,
      success: 4,
      skipped_uptodate: 5,
      skipped_beta: 6,
      skipped_legacy: 7,
      skipped_unsupported: 8,
      skipped_nofw: 9,
    };
    const rows: BulkJobDeviceRow[] = [];
    for (const [target, st] of Object.entries(states)) {
      if (filter !== 'all' && st !== filter) continue;
      const slash = target.indexOf('/');
      let info: DeviceInfo = {};
      try {
        if (infos[target]) info = JSON.parse(infos[target]) as DeviceInfo;
      } catch {
        // ignore
      }
      rows.push({
        userId: target.slice(0, slash),
        deviceId: target.slice(slash + 1),
        state: st as DeviceState,
        ...info,
      });
    }
    rows.sort(
      (a, b) =>
        (order[a.state] ?? 9) - (order[b.state] ?? 9) ||
        a.deviceId.localeCompare(b.deviceId, undefined, { numeric: true }),
    );

    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 5000);
    const safePage = Math.max(Number(page) || 1, 1);
    return {
      jobId,
      state: filter,
      total: rows.length,
      page: safePage,
      limit: safeLimit,
      data: rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    };
  }
}
