import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  HybridSetRequest,
  HybridSetting,
  HybridSettingDocument,
} from '../models/hybrid-setting.schema';
import { MqttService } from './mqtt.service';
import { AUDIT_EVENT, AuditContext, AuditEvent } from '../utils/audit-context';
import {
  HYBRID_COMMANDS,
  HybridCommand,
  HybridConfig,
  hybridConfigFromCfg,
  hybridSetBody,
  mergeHybridConfig,
  num,
  parseHybridPatch,
} from '../constants/hybrid.constants';

export interface HybridSettingView {
  userId: string;
  deviceId: string;
  /** Keys the user set (server-owned). The firmware enforces these. */
  config: HybridConfig;
  /** Same as the SET item list the firmware receives. */
  set: string;
  /** Last saved change (sent once to the device). */
  request?: HybridSetRequest | null;
  updatedAt: Date | null;
}

/** A saved change counts as "on its way" this long without a newer $CFG. */
const REQUEST_PENDING_MS = 3 * 60_000;

/**
 * The change the device has not confirmed yet: saved after the last $CFG and
 * less than 3 min ago. Afterwards the machine's $CFG is what the app shows
 * (the device sends a SET once; a refusal shows as lastNak).
 */
export function hybridOpenRequest(
  request: HybridSetRequest | null | undefined,
  cfgAt?: Date | string | null,
  now = Date.now(),
): HybridSetRequest | null {
  if (!request?.at) return null;
  const at = new Date(request.at).getTime();
  if (!Number.isFinite(at) || now - at >= REQUEST_PENDING_MS) return null;
  if (cfgAt && new Date(cfgAt).getTime() > at) return null;
  return request;
}

/**
 * Desired config of a hybrid (HINVLF v1, 9 writable keys) + one-shot commands.
 *
 * Protocol v1.1 / firmware >= 1.2: a saved change goes out ONCE as
 * cmd/action {cmd:"SET", set} (the ESP32 $SETs it, then $CMD,SAVE). The
 * device never re-applies anything on boot: the machine's $CFG is the truth.
 *
 * Firmware < 1.2: the config reaches the device by the retained trigger
 * hybrid/{uid}/{dev}/cmd/settings ("go pull it") and
 * GET /api/hybrid-setting/data/{uid}/{dev}?source=hardware -> { set }, which
 * the firmware also calls on boot and every 60 s. The firmware $SETs the
 * keys that differ from the STM32's $CFG and re-applies them after an STM32
 * reboot. Commands go on hybrid/{uid}/{dev}/cmd/action (not retained).
 */
@Injectable()
export class HybridSettingService {
  constructor(
    @InjectModel(HybridSetting.name)
    private readonly model: Model<HybridSettingDocument>,
    private readonly mqtt: MqttService,
    private readonly events: EventEmitter2,
  ) {}

  async get(userId: string, deviceId: string): Promise<HybridSettingView> {
    const doc = (await this.model
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec()) as (HybridSetting & { updatedAt?: Date }) | null;
    const config = doc?.config ?? {};
    return {
      userId,
      deviceId,
      config,
      set: hybridSetBody(config),
      request: doc?.request ?? null,
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  /**
   * Validate + store a partial config. `cfg` = the machine's latest $CFG
   * (baseline for keys never set, and the VCV / VBMAX limits).
   * Throws 400 { message, errors: [{ key, message }] }.
   */
  async update(
    userId: string,
    deviceId: string,
    input: Record<string, unknown>,
    cfg: Record<string, string> | null | undefined,
    ctx?: AuditContext,
  ): Promise<HybridSettingView> {
    const { patch, errors: parseErrors } = parseHybridPatch(input);
    if (parseErrors.length) {
      throw new BadRequestException({
        message: 'Cài đặt không hợp lệ',
        errors: parseErrors,
      });
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Không có tham số nào để lưu');
    }
    const before = await this.get(userId, deviceId);
    // The machine's $CFG is the truth (it can be changed on the machine);
    // the stored config only when no $CFG has been seen yet.
    const base = cfg ? hybridConfigFromCfg(cfg) : { ...before.config };
    const limits = { VCV: num(cfg?.VCV), VBMAX: num(cfg?.VBMAX) };
    const { changes, errors } = mergeHybridConfig(base, patch, limits);
    if (errors.length) {
      throw new BadRequestException({
        message: 'Cài đặt không hợp lệ',
        errors,
      });
    }
    const config: HybridConfig = { ...before.config, ...changes };
    const now = new Date();
    const request: HybridSetRequest = {
      config: changes,
      set: hybridSetBody(changes),
      at: now,
    };
    await this.model
      .updateOne(
        { userId, deviceId },
        { $set: { config, request, updatedAt: now } },
        { upsert: true },
      )
      .exec();
    // Firmware >= 1.2: one $SET of what changed, then $CMD,SAVE.
    if (request.set) {
      void this.mqtt
        .emitHybridSet(userId, deviceId, request.set)
        .catch(() => {});
    }
    // Firmware < 1.2 pulls the whole config (it ignores the one-shot SET).
    void this.mqtt.emitSyncHybridSettings(userId, deviceId).catch(() => {});
    const after = hybridSetBody(config);
    if (request.set) {
      this.audit(
        ctx,
        userId,
        deviceId,
        'settings',
        before.set || null,
        request.set,
      );
    }
    return { userId, deviceId, config, set: after, request, updatedAt: now };
  }

  /** FAULT_RST / STOP / RUN -> cmd/action (QoS1, not retained). */
  async command(
    userId: string,
    deviceId: string,
    cmd: string,
    ctx?: AuditContext,
  ): Promise<{ cmd: HybridCommand; sentAt: Date }> {
    const c = String(cmd ?? '').toUpperCase();
    if (!(HYBRID_COMMANDS as readonly string[]).includes(c)) {
      throw new BadRequestException(
        `cmd must be one of ${HYBRID_COMMANDS.join(', ')}`,
      );
    }
    await this.mqtt.emitHybridCommand(userId, deviceId, c);
    this.audit(ctx, userId, deviceId, 'command', null, c);
    return { cmd: c as HybridCommand, sentAt: new Date() };
  }

  /** UART debug log on for `minutes` (0 = off, max 30). CMS only. */
  async rawLog(
    userId: string,
    deviceId: string,
    minutes: number,
    ctx?: AuditContext,
  ): Promise<{ minutes: number; until: Date | null }> {
    const m = Math.max(0, Math.min(30, Math.round(Number(minutes) || 0)));
    await this.mqtt.emitHybridRawLog(userId, deviceId, m);
    this.audit(ctx, userId, deviceId, 'command', null, `RAWLOG ${m}`);
    return { minutes: m, until: m ? new Date(Date.now() + m * 60_000) : null };
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    await this.model.deleteOne({ userId, deviceId }).exec();
  }

  private audit(
    ctx: AuditContext | undefined,
    userId: string,
    deviceId: string,
    action: 'settings' | 'command',
    before: string | null,
    after: string | null,
  ) {
    this.events.emit(AUDIT_EVENT, {
      ctx: ctx ?? { source: 'system' },
      userId,
      deviceId,
      kind: 'hybrid',
      action,
      before,
      after,
    } satisfies AuditEvent);
  }
}
