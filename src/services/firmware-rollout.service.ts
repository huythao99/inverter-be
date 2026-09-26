import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  FirmwareRollout,
  FirmwareRolloutDocument,
  ROLLOUT_FAILURE_STATES,
  RolloutDevice,
  RolloutDeviceDocument,
  RolloutDeviceState,
} from '../models/firmware-rollout.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  DeviceHealth,
  DeviceHealthDocument,
} from '../models/device-health.schema';
import { EspFirmwareService } from './esp-firmware.service';
import { FirmwareBulkUpdateService } from './firmware-bulk-update.service';
import { BetaFirmwareDeviceService } from './beta-firmware-device.service';
import { DeviceHealthService } from './device-health.service';
import {
  activeRollout,
  compareFirmwareVersions,
  isLegacyDevice,
  newestFirmwareVersion,
  rolloutBucket,
  setActiveRollout,
} from './firmware.service';

export interface StartRolloutInput {
  firmwareId: string;
  stages?: number[];
  autoPush?: boolean;
  autoAdvance?: boolean;
  stageHours?: number;
  maxFailRate?: number;
  minSamples?: number;
  observeMinutes?: number;
}

export interface RolloutStats {
  eligible: number;
  onVersion: number;
  counts: Record<RolloutDeviceState, number>;
  healthy: number;
  failures: number;
  pending: number;
  failRate: number | null;
}

const STATES: RolloutDeviceState[] = [
  'pushed',
  'installing',
  'updated',
  'healthy',
  'failed',
  'rolled_back',
  'unhealthy',
  'stalled',
];
const CRASH_REASONS = new Set([4, 5, 6, 7]);
const MIN = 60_000;

/**
 * Staged rollout of the inverter ESP32 firmware (CMS "Staged rollout").
 *
 * - Each device has a fixed bucket 0..99 (hash of its deviceId); devices with
 *   bucket < percent are offered the new build by /api/firmware,
 *   /api/firmware/newest and /api/user/firmware/newest (firmware.service
 *   mirror), everyone else keeps the stable build.
 * - With autoPush each new stage sends the update command to its devices
 *   through the existing bulk-update job (batches of 10 / 10 s).
 * - Results come from the devices' ota/status reports, the version they PATCH
 *   after each boot, and their telemetry (DeviceHealthService).
 * - Too many failures -> paused automatically (nobody new gets the build).
 * - Finishing the last stage makes the build the stable one.
 */
@Injectable()
export class FirmwareRolloutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirmwareRolloutService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @InjectModel(FirmwareRollout.name)
    private rolloutModel: Model<FirmwareRolloutDocument>,
    @InjectModel(RolloutDevice.name)
    private deviceModel: Model<RolloutDeviceDocument>,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    @InjectModel(DeviceHealth.name)
    private healthModel: Model<DeviceHealthDocument>,
    private espFirmwareService: EspFirmwareService,
    private bulkService: FirmwareBulkUpdateService,
    private betaService: BetaFirmwareDeviceService,
    private healthService: DeviceHealthService,
  ) {}

  async onModuleInit() {
    await this.refreshMirror().catch(() => undefined);
    this.timer = setInterval(() => void this.tick(), MIN);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async current(): Promise<FirmwareRolloutDocument | null> {
    return this.rolloutModel
      .findOne({ product: 'inverter', status: { $in: ['running', 'paused'] } })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Copy the active rollout into the in-memory mirror firmware.service reads. */
  async refreshMirror(): Promise<void> {
    const r = await this.current();
    setActiveRollout(
      r
        ? {
            id: String(r._id),
            version: r.version,
            url: r.url,
            percent: r.percent,
            status: r.status as 'running' | 'paused',
          }
        : null,
    );
  }

  private event(
    r: FirmwareRolloutDocument,
    type: string,
    message: string,
    by?: string | null,
  ) {
    r.events.push({ at: new Date(), type, message, by: by ?? null });
    if (r.events.length > 200) r.events = r.events.slice(-200);
    this.logger.log(`rollout v${r.version}: ${type} - ${message}`);
  }

  private isEligible(
    r: { percent: number },
    d: { deviceId: string; userId: string },
  ) {
    return (
      !isLegacyDevice(d.deviceId) &&
      !this.betaService.isBeta(d.deviceId, d.userId) &&
      rolloutBucket(d.deviceId) < r.percent
    );
  }

  // ---- Commands -----------------------------------------------------------

  async start(input: StartRolloutInput, by: string | null) {
    if (await this.current()) {
      throw new ConflictException(
        'Another rollout is running or paused - finish or abort it first',
      );
    }
    const fw = await this.espFirmwareService.get(input.firmwareId);
    if (!fw) throw new NotFoundException('Firmware not found');
    if ((fw.product ?? 'inverter') !== 'inverter') {
      throw new BadRequestException('Only inverter firmware can be rolled out');
    }
    const stable = newestFirmwareVersion();
    if (compareFirmwareVersions(fw.version, stable) <= 0) {
      throw new BadRequestException(
        `v${fw.version} is not newer than the current stable v${stable}`,
      );
    }
    const stages = (input.stages?.length ? input.stages : [5, 25, 50, 100])
      .map((n) => Math.round(Number(n)))
      .filter((n) => n >= 1 && n <= 100);
    const sorted = [...new Set(stages)].sort((a, b) => a - b);
    if (!sorted.length || sorted[sorted.length - 1] !== 100) sorted.push(100);

    const clamp = (v: unknown, lo: number, hi: number, def: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
    };
    const r = new this.rolloutModel({
      product: 'inverter',
      firmwareId: String(fw._id),
      version: fw.version,
      url: fw.url,
      fromVersion: stable,
      stages: sorted,
      stageIndex: 0,
      percent: sorted[0],
      status: 'running',
      autoPush: input.autoPush ?? true,
      autoAdvance: input.autoAdvance ?? false,
      stageHours: clamp(input.stageHours, 1, 24 * 14, 24),
      maxFailRate: clamp(input.maxFailRate, 0.01, 1, 0.2),
      minSamples: Math.round(clamp(input.minSamples, 1, 1000, 5)),
      observeMinutes: Math.round(clamp(input.observeMinutes, 5, 24 * 60, 30)),
      stageStartedAt: new Date(),
      createdBy: by,
      events: [],
    });
    this.event(
      r,
      'start',
      `Started v${fw.version} (from v${stable}), stage 1: ${sorted[0]}%`,
      by,
    );
    if (r.autoPush) r.pendingPush = true;
    await r.save();
    await this.refreshMirror();
    if (r.autoPush) await this.push(r);
    return this.status(String(r._id));
  }

  async action(
    id: string,
    action: 'pause' | 'resume' | 'advance' | 'abort' | 'push',
    by: string | null,
  ) {
    const r = await this.rolloutModel.findById(id).exec();
    if (!r) throw new NotFoundException('Rollout not found');
    if (r.status === 'completed' || r.status === 'aborted') {
      throw new BadRequestException('Rollout already finished');
    }
    switch (action) {
      case 'pause':
        if (r.status !== 'running')
          throw new BadRequestException('Rollout is not running');
        r.status = 'paused';
        r.pauseReason = 'Paused manually';
        this.event(r, 'pause', 'Paused manually', by);
        break;
      case 'resume':
        if (r.status !== 'paused')
          throw new BadRequestException('Rollout is not paused');
        r.status = 'running';
        r.pauseReason = null;
        this.event(r, 'resume', `Resumed at ${r.percent}%`, by);
        break;
      case 'advance':
        await this.advance(r, by);
        break;
      case 'push':
        if (r.status !== 'running')
          throw new BadRequestException('Rollout is not running');
        r.pendingPush = true;
        this.event(
          r,
          'push',
          'Re-sending the update command to the current stage',
          by,
        );
        break;
      case 'abort':
        r.status = 'aborted';
        r.pendingPush = false;
        this.event(
          r,
          'abort',
          'Aborted - devices not updated yet stay on stable',
          by,
        );
        break;
    }
    await r.save();
    await this.refreshMirror();
    if (r.status === 'running' && r.pendingPush) await this.push(r);
    return this.status(id);
  }

  /** Next stage, or finish (build becomes stable) after the last one. */
  private async advance(r: FirmwareRolloutDocument, by: string | null) {
    if (r.stageIndex >= r.stages.length - 1) {
      await this.espFirmwareService.activate(r.firmwareId, 'stable');
      r.status = 'completed';
      r.pendingPush = false;
      this.event(r, 'complete', `Completed: v${r.version} is now stable`, by);
      return;
    }
    r.stageIndex += 1;
    r.percent = r.stages[r.stageIndex];
    r.status = 'running';
    r.pauseReason = null;
    r.stageStartedAt = new Date();
    if (r.autoPush) r.pendingPush = true;
    this.event(r, 'advance', `Stage ${r.stageIndex + 1}: ${r.percent}%`, by);
  }

  /** Send the update command to eligible devices not on the build yet. */
  private async push(r: FirmwareRolloutDocument): Promise<void> {
    if (r.status !== 'running' || !r.pendingPush) return;
    const devices = await this.inverterDeviceModel
      .find({}, { userId: 1, deviceId: 1, firmwareVersion: 1 })
      .lean()
      .exec();
    const targets = devices.filter(
      (d) =>
        this.isEligible(r, d) &&
        (!d.firmwareVersion ||
          compareFirmwareVersions(d.firmwareVersion, r.version) < 0),
    );
    if (!targets.length) {
      r.pendingPush = false;
      this.event(r, 'push', 'No device left to update in this stage');
      await r.save();
      return;
    }
    try {
      const job = await this.bulkService.start({
        ids: targets.map((d) => String(d._id)),
      });
      r.pendingPush = false;
      this.event(
        r,
        'push',
        `Update command sent to ${job.total} device(s) (bulk job ${job.jobId.slice(0, 8)})`,
      );
      const rid = String(r._id);
      const ops = targets.map((d) => ({
        updateOne: {
          filter: { rolloutId: rid, userId: d.userId, deviceId: d.deviceId },
          update: {
            $setOnInsert: {
              state: 'pushed' as RolloutDeviceState,
              fromVersion: d.firmwareVersion ?? null,
            },
          },
          upsert: true,
        },
      }));
      for (let i = 0; i < ops.length; i += 1000) {
        await this.deviceModel.bulkWrite(ops.slice(i, i + 1000), {
          ordered: false,
        });
      }
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        // Nothing left to send (all up to date / skipped).
        r.pendingPush = false;
        this.event(r, 'push', `Nothing sent: ${(err as Error).message}`);
      } else {
        // Another bulk job still sending / Redis or MQTT down: retry next tick.
        const last = r.events[r.events.length - 1];
        if (last?.type !== 'push_wait') {
          this.event(
            r,
            'push_wait',
            `Could not send yet: ${(err as Error).message} - retrying every minute`,
          );
        }
      }
    }
    await r.save();
  }

  // ---- Device reports -----------------------------------------------------

  private async trackedRollout(d: { userId: string; deviceId: string }) {
    const m = activeRollout();
    if (!m) return null;
    const row = await this.deviceModel
      .findOne({ rolloutId: m.id, userId: d.userId, deviceId: d.deviceId })
      .exec();
    if (row) return { m, row };
    if (m.status !== 'running') return null;
    if (!this.isEligible(m, d)) return null;
    return { m, row: null };
  }

  @OnEvent('ota.status.received', { async: true })
  async onOta(p: {
    userId: string;
    deviceId: string;
    status?: string;
    message?: string;
  }) {
    if (!p?.status) return;
    try {
      const t = await this.trackedRollout(p);
      if (!t) return;
      const filter = {
        rolloutId: t.m.id,
        userId: p.userId,
        deviceId: p.deviceId,
      };
      const cur = t.row?.state;
      if (
        cur &&
        ['updated', 'healthy', 'rolled_back', 'unhealthy'].includes(cur)
      ) {
        await this.deviceModel
          .updateOne(filter, { $set: { otaStatus: p.status } })
          .exec();
        return;
      }
      const set: Record<string, unknown> = { otaStatus: p.status };
      if (p.status === 'failed') {
        set.state = 'failed';
        set.reason = (p.message ?? 'OTA failed').slice(0, 200);
      } else if (p.status === 'success') {
        set.state = 'installing';
        set.otaSuccessAt = new Date();
      } else {
        set.state = 'installing';
      }
      await this.deviceModel
        .updateOne(filter, { $set: set }, { upsert: true })
        .exec();
    } catch (err) {
      this.logger.warn(`rollout ota event: ${(err as Error).message}`);
    }
  }

  @OnEvent('device.firmware.reported', { async: true })
  async onVersion(p: { userId: string; deviceId: string; version: string }) {
    try {
      const t = await this.trackedRollout(p);
      if (!t) return;
      const filter = {
        rolloutId: t.m.id,
        userId: p.userId,
        deviceId: p.deviceId,
      };
      const cmp = compareFirmwareVersions(p.version, t.m.version);
      if (cmp >= 0) {
        if (!t.row || !['updated', 'healthy'].includes(t.row.state)) {
          await this.deviceModel
            .updateOne(
              filter,
              {
                $set: {
                  state: 'updated',
                  updatedAt2: new Date(),
                  reason: null,
                },
              },
              { upsert: true },
            )
            .exec();
        }
      } else if (
        t.row &&
        (t.row.state === 'updated' ||
          t.row.state === 'healthy' ||
          (t.row.state === 'installing' && t.row.otaSuccessAt))
      ) {
        // Booted the old build again after a successful OTA: the bootloader
        // rolled back (new build didn't confirm) or someone re-flashed it.
        await this.deviceModel
          .updateOne(filter, {
            $set: { state: 'rolled_back', reason: `Back on v${p.version}` },
          })
          .exec();
      }
    } catch (err) {
      this.logger.warn(`rollout version event: ${(err as Error).message}`);
    }
  }

  // ---- Periodic check -----------------------------------------------------

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshMirror();
      const r = await this.current();
      if (!r) return;
      await this.observe(r);
      if (r.status === 'running' && r.pendingPush) await this.push(r);
      const stats = await this.stats(r);
      if (r.status === 'running') {
        const samples = stats.healthy + stats.failures;
        if (
          samples >= r.minSamples &&
          stats.failRate !== null &&
          stats.failRate > r.maxFailRate
        ) {
          r.status = 'paused';
          r.pauseReason = `Auto-paused: ${stats.failures}/${samples} devices failed (${Math.round(stats.failRate * 100)}% > ${Math.round(r.maxFailRate * 100)}%)`;
          this.event(r, 'auto_pause', r.pauseReason);
          await r.save();
          await this.refreshMirror();
          return;
        }
        const stageAgeH =
          (Date.now() - new Date(r.stageStartedAt).getTime()) / 3600_000;
        if (
          r.autoAdvance &&
          stageAgeH >= r.stageHours &&
          samples >= r.minSamples &&
          stats.pending === 0
        ) {
          await this.advance(r, 'auto');
          await r.save();
          await this.refreshMirror();
          if (r.status === 'running' && r.pendingPush) await this.push(r);
        }
      }
    } catch (err) {
      this.logger.warn(`rollout tick: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Decide healthy / unhealthy / stalled for devices past their window. */
  private async observe(r: FirmwareRolloutDocument): Promise<void> {
    const rid = String(r._id);
    const now = Date.now();
    const observeMs = r.observeMinutes * MIN;

    const updated = await this.deviceModel
      .find({
        rolloutId: rid,
        state: 'updated',
        updatedAt2: { $lte: new Date(now - observeMs) },
      })
      .limit(500)
      .exec();
    if (updated.length) {
      const health = await this.healthModel
        .find(
          {
            $or: updated.map((d) => ({
              userId: d.userId,
              deviceId: d.deviceId,
            })),
          },
          { userId: 1, deviceId: 1, lastDataAt: 1, boots: 1 },
        )
        .lean()
        .exec();
      const byKey = new Map(
        health.map((h) => [`${h.userId}\t${h.deviceId}`, h]),
      );
      for (const d of updated) {
        const h = byKey.get(`${d.userId}\t${d.deviceId}`);
        const since = new Date(d.updatedAt2 ?? d.updatedAt).getTime();
        const mem = this.healthService.lastSeenAt(d.userId, d.deviceId) ?? 0;
        const seen = Math.max(
          mem,
          h?.lastDataAt ? new Date(h.lastDataAt).getTime() : 0,
        );
        const crashes = (h?.boots ?? []).filter(
          (b) =>
            new Date(b.at).getTime() > since && CRASH_REASONS.has(b.reason),
        ).length;
        let state: RolloutDeviceState = 'healthy';
        let reason: string | null = null;
        if (crashes >= 2) {
          state = 'unhealthy';
          reason = `${crashes} crash/WDT resets after the update`;
        } else if (seen < since + observeMs * 0.5) {
          state = 'unhealthy';
          reason = 'No telemetry after the update';
        }
        await this.deviceModel
          .updateOne({ _id: d._id }, { $set: { state, reason } })
          .exec();
      }
    }

    // Reported success but never came back with the new version.
    await this.deviceModel
      .updateMany(
        {
          rolloutId: rid,
          state: 'installing',
          otaSuccessAt: { $ne: null, $lte: new Date(now - 20 * MIN) },
        },
        {
          $set: {
            state: 'unhealthy',
            reason: 'Reported success but never booted the new version',
          },
        },
      )
      .exec();
    // Started but went silent: probably lost power/WiFi - not counted.
    await this.deviceModel
      .updateMany(
        {
          rolloutId: rid,
          state: 'installing',
          otaSuccessAt: null,
          updatedAt: { $lte: new Date(now - 45 * MIN) },
        },
        {
          $set: {
            state: 'stalled',
            reason: 'Started but never reported a result',
          },
        },
      )
      .exec();
  }

  // ---- Read side ----------------------------------------------------------

  async stats(
    r: FirmwareRolloutDocument | FirmwareRollout,
  ): Promise<RolloutStats> {
    const rid = String(r._id);
    const agg = await this.deviceModel
      .aggregate<{
        _id: RolloutDeviceState;
        n: number;
      }>([
        { $match: { rolloutId: rid } },
        { $group: { _id: '$state', n: { $sum: 1 } } },
      ])
      .exec();
    const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<
      RolloutDeviceState,
      number
    >;
    for (const a of agg) counts[a._id] = a.n;
    const devices = await this.inverterDeviceModel
      .find({}, { userId: 1, deviceId: 1, firmwareVersion: 1 })
      .lean()
      .exec();
    const eligible = devices.filter((d) => this.isEligible(r, d));
    const onVersion = eligible.filter(
      (d) =>
        d.firmwareVersion &&
        compareFirmwareVersions(d.firmwareVersion, r.version) >= 0,
    ).length;
    const failures = ROLLOUT_FAILURE_STATES.reduce((s, k) => s + counts[k], 0);
    const healthy = counts.healthy;
    return {
      eligible: eligible.length,
      onVersion,
      counts,
      healthy,
      failures,
      pending: counts.installing + counts.updated,
      failRate: healthy + failures > 0 ? failures / (healthy + failures) : null,
    };
  }

  async status(id: string) {
    const r = await this.rolloutModel.findById(id).lean().exec();
    if (!r) throw new NotFoundException('Rollout not found');
    return { ...r, _id: String(r._id), stats: await this.stats(r) };
  }

  async active() {
    const r = await this.current();
    return r ? this.status(String(r._id)) : null;
  }

  async list() {
    return this.rolloutModel
      .find({ product: 'inverter' }, { events: 0 })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec();
  }

  async devices(id: string, state?: string, page = 1, limit = 50) {
    const filter: Record<string, unknown> = { rolloutId: id };
    if (state && STATES.includes(state as RolloutDeviceState))
      filter.state = state;
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const pg = Math.max(Number(page) || 1, 1);
    const [data, total] = await Promise.all([
      this.deviceModel
        .find(filter, { __v: 0 })
        .sort({ updatedAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean()
        .exec(),
      this.deviceModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page: pg, limit: lim };
  }
}
