import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
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
  updatedAt: Date | null;
}

/**
 * Desired config of a hybrid (HINVLF v1, 9 writable keys) + one-shot commands.
 *
 * The config reaches the device by the retained trigger
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
    const base = { ...hybridConfigFromCfg(cfg), ...before.config };
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
    await this.model
      .updateOne(
        { userId, deviceId },
        { $set: { config, updatedAt: now } },
        { upsert: true },
      )
      .exec();
    void this.mqtt.emitSyncHybridSettings(userId, deviceId).catch(() => {});
    const after = hybridSetBody(config);
    if (after !== before.set) {
      this.audit(ctx, userId, deviceId, 'settings', before.set || null, after);
    }
    return { userId, deviceId, config, set: after, updatedAt: now };
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
