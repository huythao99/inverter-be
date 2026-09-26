import type { Request } from 'express';
import type { AuditSource } from '../models/audit-log.schema';

/** Who / where a change comes from. Passed from controllers to services. */
export interface AuditContext {
  source: AuditSource;
  actor?: string | null;
  actorLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Event name the services emit, AuditLogService stores it. */
export const AUDIT_EVENT = 'audit.record';

export interface AuditEvent {
  ctx: AuditContext;
  userId: string;
  deviceId: string;
  kind: 'inverter' | 'charger';
  action: 'settings' | 'schedule' | 'grid-tie';
  before: string | null;
  after: string | null;
}

function clientIp(req: Request): string | null {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real.slice(0, 64);
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return (
    (first || req.ip || req.socket?.remoteAddress || null)?.slice(0, 64) ?? null
  );
}

/**
 * Build the audit context of an HTTP request.
 * Without an explicit source: the Flutter app sends "Dart/..." as its
 * User-Agent, browsers "Mozilla/..." -> web; anything else = api.
 */
export function auditCtx(
  req: Request,
  opts: {
    source?: AuditSource;
    actor?: string | null;
    actorLabel?: string | null;
  } = {},
): AuditContext {
  const ua = (req.headers['user-agent'] ?? '').toString();
  let source = opts.source;
  if (!source) {
    if (/dart|okhttp|cfnetwork|flutter/i.test(ua)) source = 'app';
    else if (/mozilla/i.test(ua)) source = 'web';
    else source = 'api';
  }
  return {
    source,
    actor: opts.actor ?? null,
    actorLabel: opts.actorLabel ?? null,
    ip: clientIp(req),
    userAgent: ua ? ua.slice(0, 200) : null,
  };
}
