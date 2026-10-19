import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  HybridSetting,
  HybridSettingDocument,
} from '../models/hybrid-setting.schema';
import { MqttService } from './mqtt.service';
import { AUDIT_EVENT, AuditContext, AuditEvent } from '../utils/audit-context';

export interface HybridSettingView {
  userId: string;
  deviceId: string;
  value: string;
  gridTieOff: boolean;
}

/**
 * Setting (VBAT/IBAT, 8 digits like the charger) + grid-tie state of a hybrid.
 *
 * Both reach the device two ways:
 * - retained triggers on hybrid/{uid}/{dev}/cmd/settings (pull the setting)
 *   and hybrid/{uid}/{dev}/cmd/grid-tie {"off":bool};
 * - GET /api/hybrid-setting/data/{uid}/{dev}?source=hardware, which the
 *   firmware calls on boot, on cmd/settings and every 60 s.
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
    const doc = await this.model
      .findOne({ userId, deviceId })
      .lean()
      .maxTimeMS(2000)
      .exec();
    return {
      userId,
      deviceId,
      value: doc?.value ?? '',
      gridTieOff: doc?.gridTieOff === true,
    };
  }

  async setValue(
    userId: string,
    deviceId: string,
    value: string,
    ctx?: AuditContext,
  ): Promise<HybridSettingView> {
    const before = await this.get(userId, deviceId);
    await this.model
      .findOneAndUpdate(
        { userId, deviceId },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true },
      )
      .exec();
    void this.mqtt.emitSyncHybridSettings(userId, deviceId).catch(() => {});
    this.audit(ctx, userId, deviceId, 'settings', before.value || null, value);
    return { ...before, value };
  }

  async setGridTie(
    userId: string,
    deviceId: string,
    off: boolean,
    ctx?: AuditContext,
  ): Promise<HybridSettingView> {
    const before = await this.get(userId, deviceId);
    await this.model
      .findOneAndUpdate(
        { userId, deviceId },
        { $set: { gridTieOff: off, updatedAt: new Date() } },
        { upsert: true },
      )
      .exec();
    // Dedicated retained command + a settings pull (the API also carries it).
    await this.mqtt.emitHybridGridTie(userId, deviceId, off).catch(() => {});
    void this.mqtt.emitSyncHybridSettings(userId, deviceId).catch(() => {});
    if (before.gridTieOff !== off) {
      this.audit(
        ctx,
        userId,
        deviceId,
        'grid-tie',
        before.gridTieOff ? '1' : '0',
        off ? '1' : '0',
      );
    }
    return { ...before, gridTieOff: off };
  }

  private audit(
    ctx: AuditContext | undefined,
    userId: string,
    deviceId: string,
    action: 'settings' | 'grid-tie',
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
