import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../models/audit-log.schema';
import { AUDIT_EVENT, AuditEvent } from '../utils/audit-context';
import {
  BLACKLIST_OFF_VALUE,
  GRID_TIE_OFF_VALUE,
} from '../constants/grid-tie.constants';
import { decodeChargerValue } from '../utils/charger-value.util';

export interface AuditLogRow {
  _id: string;
  deviceId: string;
  kind: string;
  action: string;
  source: string;
  actor: string | null;
  actorLabel: string | null;
  summary: string;
  before: string | null;
  after: string | null;
  createdAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}

const vn = (n: number, d = 0) =>
  n.toLocaleString('vi-VN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

/** "XXXXYYYY..." -> vBatt (V) / pMax (W); special command values by name. */
function describeInverterValue(v: string | null): string {
  if (!v) return 'chưa có';
  if (v === GRID_TIE_OFF_VALUE) return 'lệnh TẮT hoà lưới';
  if (v === BLACKLIST_OFF_VALUE) return 'lệnh khoá (blacklist)';
  if (!/^\d{8}/.test(v)) return v;
  const vBatt = parseInt(v.slice(0, 4), 10) / 100;
  const pMax = parseInt(v.slice(4, 8), 10) - 1000;
  return `${vn(vBatt, 2)} V / ${vn(pMax)} W`;
}

function inverterSettingsSummary(before: string | null, after: string | null) {
  if (!before || !/^\d{8}/.test(before) || !/^\d{8}/.test(after ?? '')) {
    return `${describeInverterValue(before)} → ${describeInverterValue(after)}`;
  }
  const parts: string[] = [];
  const b1 = parseInt(before.slice(0, 4), 10) / 100;
  const a1 = parseInt(after!.slice(0, 4), 10) / 100;
  const b2 = parseInt(before.slice(4, 8), 10) - 1000;
  const a2 = parseInt(after!.slice(4, 8), 10) - 1000;
  if (b1 !== a1) parts.push(`Ngưỡng điện áp pin ${vn(b1, 2)} → ${vn(a1, 2)} V`);
  if (b2 !== a2) parts.push(`Công suất xả tối đa ${vn(b2)} → ${vn(a2)} W`);
  if (!parts.length) {
    return `${describeInverterValue(before)} → ${describeInverterValue(after)}`;
  }
  return parts.join('; ');
}

/** UTC "HH:MM" -> GMT+7 "HH:MM". */
function toLocal(t?: string): string {
  if (!t) return '--:--';
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  return `${String((h + 7) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseSchedule(s: string | null): string[] {
  if (!s) return [];
  return s
    .split('#')
    .filter(Boolean)
    .map((slot) => {
      const p: Record<string, string> = {};
      for (const kv of slot.split('&')) {
        const i = kv.indexOf('=');
        if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return `${toLocal(p.start)}–${toLocal(p.end)} ${describeInverterValue(p.value ?? null)}`;
    });
}

function scheduleSummary(before: string | null, after: string | null) {
  const b = parseSchedule(before);
  const a = parseSchedule(after);
  if (!a.length) return 'Xoá hết khung giờ';
  if (b.length === a.length) {
    const changed = a
      .map((slot, i) =>
        slot !== b[i] ? `Khung ${i + 1}: ${b[i]} → ${slot}` : null,
      )
      .filter(Boolean);
    if (changed.length) return changed.join('; ');
  }
  return `${a.length} khung giờ: ${a.join('; ')}`;
}

function chargerSummary(before: string | null, after: string | null) {
  const d = (v: string | null) => {
    const x = v ? decodeChargerValue(v) : null;
    return x ? `${vn(x.vbat, 1)} V / ${vn(x.ibat, 1)} A` : (v ?? 'chưa có');
  };
  return `${d(before)} → ${d(after)}`;
}

export function buildAuditSummary(
  e: Pick<AuditEvent, 'kind' | 'action' | 'before' | 'after'>,
): string {
  if (e.action === 'grid-tie') {
    return e.after === '1' ? 'Tắt hoà lưới' : 'Bật hoà lưới';
  }
  if (e.kind === 'charger') return chargerSummary(e.before, e.after);
  if (e.action === 'schedule') return scheduleSummary(e.before, e.after);
  return inverterSettingsSummary(e.before, e.after);
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLogDocument>,
  ) {}

  /** Services emit AUDIT_EVENT after a successful write; never throws. */
  @OnEvent(AUDIT_EVENT, { async: true })
  async record(e: AuditEvent): Promise<void> {
    if (e.before === e.after) return; // re-save of the same value
    try {
      await this.auditModel.create({
        userId: e.userId,
        deviceId: e.deviceId,
        kind: e.kind,
        action: e.action,
        source: e.ctx.source,
        actor: e.ctx.actor ?? null,
        actorLabel: e.ctx.actorLabel ?? null,
        before: e.before,
        after: e.after,
        summary: buildAuditSummary(e),
        ip: e.ctx.ip ?? null,
        userAgent: e.ctx.userAgent ?? null,
      });
    } catch (err) {
      this.logger.warn(`audit write failed: ${(err as Error).message}`);
    }
  }

  /**
   * Newest first. `before` = ISO date cursor (createdAt of the last row of
   * the previous page). Owners don't get ip / user agent.
   */
  async list(opts: {
    userId?: string;
    deviceId?: string;
    kind?: 'inverter' | 'charger';
    before?: string;
    limit?: number;
    withNetwork?: boolean;
  }): Promise<{ data: AuditLogRow[]; nextBefore: string | null }> {
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
    const filter: Record<string, unknown> = {};
    if (opts.userId) filter.userId = opts.userId;
    if (opts.deviceId) filter.deviceId = opts.deviceId;
    if (opts.kind) filter.kind = opts.kind;
    if (opts.before) {
      const d = new Date(opts.before);
      if (!Number.isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }
    const projection: Record<string, 0> = opts.withNetwork
      ? { __v: 0 }
      : { __v: 0, ip: 0, userAgent: 0 };
    const rows = await this.auditModel
      .find(filter, projection)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean()
      .maxTimeMS(5000)
      .exec();
    const more = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => ({
      ...r,
      _id: String(r._id),
    })) as unknown as AuditLogRow[];
    return {
      data,
      nextBefore: more
        ? new Date(data[data.length - 1].createdAt).toISOString()
        : null,
    };
  }
}
