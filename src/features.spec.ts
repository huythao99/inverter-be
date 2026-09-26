/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { billForKwh, DEFAULT_EVN_TIERS } from './constants/evn-tariff';
import { buildAuditSummary } from './services/audit-log.service';
import {
  rolloutBucket,
  setActiveRollout,
  stableTargetFor,
  inActiveRollout,
} from './services/firmware.service';

describe('EVN tariff', () => {
  it('matches the published 400 kWh example (1,074,500 đ before VAT)', () => {
    expect(billForKwh(400, DEFAULT_EVN_TIERS, 0)).toBe(1074500);
    expect(billForKwh(400, DEFAULT_EVN_TIERS, 8)).toBe(1160460);
  });
  it('is 0 for 0 kWh and uses the top tier above 400 kWh', () => {
    expect(billForKwh(0, DEFAULT_EVN_TIERS, 8)).toBe(0);
    expect(billForKwh(410, DEFAULT_EVN_TIERS, 0)).toBe(1074500 + 10 * 3460);
  });
});

describe('audit summary', () => {
  it('describes an inverter setting change', () => {
    const s = buildAuditSummary({
      kind: 'inverter',
      action: 'settings',
      before: '48001500',
      after: '50001800',
    });
    expect(s).toContain('48,00 → 50,00 V');
    expect(s).toContain('500 → 800 W');
  });
  it('describes grid-tie and schedule changes', () => {
    expect(
      buildAuditSummary({
        kind: 'inverter',
        action: 'grid-tie',
        before: '0',
        after: '1',
      }),
    ).toBe('Tắt hoà lưới');
    const s = buildAuditSummary({
      kind: 'inverter',
      action: 'schedule',
      before: 'start=01:00&end=10:00&value=48001500',
      after: 'start=02:00&end=10:00&value=48001500',
    });
    expect(s).toContain('Khung 1: 08:00–17:00');
    expect(s).toContain('09:00–17:00');
  });
  it('describes a charger change', () => {
    expect(
      buildAuditSummary({
        kind: 'charger',
        action: 'settings',
        before: '05400200',
        after: '05600250',
      }),
    ).toBe('54,0 V / 20,0 A → 56,0 V / 25,0 A');
  });
});

describe('staged rollout buckets', () => {
  afterEach(() => setActiveRollout(null));
  it('is stable and in 0..99', () => {
    const b = rolloutBucket('GTIControl1218');
    expect(b).toBe(rolloutBucket('GTIControl1218'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
  it('spreads devices roughly evenly', () => {
    let under10 = 0;
    for (let i = 436; i < 3436; i++)
      if (rolloutBucket(`GTIControl${i}`) < 10) under10++;
    expect(under10).toBeGreaterThan(200);
    expect(under10).toBeLessThan(400);
  });
  it('offers the rollout build only to devices in the running share', () => {
    const inIt = Array.from(
      { length: 500 },
      (_, i) => `GTIControl${1000 + i}`,
    ).find((d) => rolloutBucket(d) < 5)!;
    const outIt = Array.from(
      { length: 500 },
      (_, i) => `GTIControl${1000 + i}`,
    ).find((d) => rolloutBucket(d) >= 5)!;
    setActiveRollout({
      id: 'r',
      version: '9.9.9',
      url: 'u',
      percent: 5,
      status: 'running',
    });
    expect(stableTargetFor(inIt).version).toBe('9.9.9');
    expect(stableTargetFor(outIt).version).not.toBe('9.9.9');
    expect(inActiveRollout('GTIControl12')).toBe(false); // legacy (< 436)
    setActiveRollout({
      id: 'r',
      version: '9.9.9',
      url: 'u',
      percent: 5,
      status: 'paused',
    });
    expect(stableTargetFor(inIt).version).not.toBe('9.9.9');
  });
});

import { DeviceHealthService } from './services/device-health.service';

describe('device health', () => {
  const updates: Array<Record<string, any>> = [];
  const healthModel = {
    updateOne: (_f: unknown, u: Record<string, any>) => {
      updates.push(u);
      return Promise.resolve();
    },
  };
  const svc = new DeviceHealthService(healthModel as any, {} as any);
  const build = (h: any, extra: Partial<{ online: boolean }> = {}) =>
    (svc as any).buildRow(
      { userId: 'u', deviceId: 'GTIControl1218', firmwareVersion: '1.0.19' },
      { lastDataAt: extra.online === false ? null : new Date(), ...h },
      Date.now(),
      '1.0.19',
    );

  it('parses BOOT / UART_STATS / STACK_STATS reports', async () => {
    await svc.onLog({
      userId: 'u',
      deviceId: 'd',
      errorCode: 'BOOT',
      errorMessage: 'reset_reason=6 fw=1.0.19',
    });
    expect(updates[0].$push.boots.$each[0]).toMatchObject({
      reason: 6,
      fw: '1.0.19',
    });
    await svc.onLog({
      userId: 'u',
      deviceId: 'd',
      errorCode: 'UART_STATS',
      errorMessage: 'ok=0 fe=0 pe=0 fld=58 num=0',
    });
    expect(updates[1].$set.uart).toMatchObject({ ok: 0, bad: 58 });
    await svc.onLog({
      userId: 'u',
      deviceId: 'd',
      errorCode: 'STACK_STATS',
      errorMessage:
        'heap=90000 min=15000 blk=40000 loop=3000 worker=2000 async=1000 rssi=-85',
    });
    expect(updates[2].$set).toMatchObject({
      rssi: -85,
      heap: { free: 90000, min: 15000 },
    });
    await svc.onLog({
      userId: 'u',
      deviceId: 'd',
      errorCode: 'MQTT_TRANSPORT',
      errorMessage: 'plain:1883 (TLS fallback)',
    });
    expect(updates[3].$set.transport).toBe('plain');
  });

  it('derives issues', () => {
    const now = new Date();
    expect(build({}).issues).toEqual([]);
    expect(build({}, { online: false }).issues).toContain('offline');
    const r = build({
      boots: [
        { at: now, reason: 6 },
        { at: now, reason: 1 },
        { at: now, reason: 9 },
      ],
      uart: { at: now, ok: 0, bad: 58, raw: '' },
      transport: 'plain',
      heap: { at: now, free: 1, min: 15000, blk: 1 },
      rssi: -85,
      rssiAt: now,
    });
    expect(r.issues).toEqual(
      expect.arrayContaining([
        'reboot_loop',
        'crash',
        'brownout',
        'uart',
        'plain_mqtt',
        'low_heap',
        'weak_wifi',
      ]),
    );
  });
});
