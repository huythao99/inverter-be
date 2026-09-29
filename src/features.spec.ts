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

import {
  allocateShare,
  decodePowerField,
  encodeShareWatts,
} from './services/share.service';

describe('power share', () => {
  it('encodes watts like the app (+1000) and decodes settings', () => {
    expect(encodeShareWatts(1500)).toBe(2500);
    expect(encodeShareWatts(387)).toBe(1387);
    expect(encodeShareWatts(-5)).toBe(1000);
    expect(encodeShareWatts(20000)).toBe(9999);
    expect(decodePowerField('48002500')).toBe(1500);
    expect(decodePowerField('99001001')).toBe(1);
    expect(decodePowerField('abc')).toBeNull();
  });

  it('splits 1000 W + 2000 W half/half into 1500 W each', () => {
    const r = allocateShare(3000, [
      { deviceId: 'a', ratio: 1, cap: 8999 },
      { deviceId: 'b', ratio: 1, cap: 8999 },
    ]);
    expect(r).toEqual({ a: 1500, b: 1500 });
  });

  it('never exceeds a member cap and gives the rest to the others', () => {
    const r = allocateShare(3000, [
      { deviceId: 'a', ratio: 1, cap: 1000 },
      { deviceId: 'b', ratio: 1, cap: 2500 },
    ]);
    expect(r).toEqual({ a: 1000, b: 2000 });
    const full = allocateShare(5000, [
      { deviceId: 'a', ratio: 1, cap: 1000 },
      { deviceId: 'b', ratio: 3, cap: 2500 },
    ]);
    expect(full).toEqual({ a: 1000, b: 2500 });
  });

  it('respects ratios and ignores ratio 0', () => {
    expect(
      allocateShare(4000, [
        { deviceId: 'a', ratio: 1, cap: 8999 },
        { deviceId: 'b', ratio: 3, cap: 8999 },
        { deviceId: 'c', ratio: 0, cap: 8999 },
      ]),
    ).toEqual({ a: 1000, b: 3000, c: 0 });
    expect(allocateShare(4000, [{ deviceId: 'a', ratio: 0, cap: 1 }])).toEqual(
      {},
    );
  });
});

import { ShareService } from './services/share.service';

describe('share service flow', () => {
  const chain = (v: unknown) => ({
    lean: () => chain(v),
    maxTimeMS: () => chain(v),
    exec: () => Promise.resolve(v),
  });
  const make = (fw: string | null) => {
    const sent: Array<{ id: string; value: number }> = [];
    const syncs: string[] = [];
    const group = {
      _id: 'g1',
      userId: 'u',
      name: 'G',
      enabled: true,
      members: [
        { deviceId: 'a', ratio: 1 },
        { deviceId: 'b', ratio: 1 },
      ],
    };
    const svc = new ShareService(
      {
        findOne: () => chain(group),
        findOneAndDelete: () => chain(group),
      } as any,
      {
        getLatestValueFromMemory: () => null,
        findLatestByUserIdAndDeviceId: () => Promise.resolve(null),
      } as any,
      { isOff: () => Promise.resolve(false) } as any,
      {
        emitShareValue: (_u: string, id: string, value: number) => {
          sent.push({ id, value });
          return Promise.resolve();
        },
        emitSyncSettings: (_u: string, id: string) => {
          syncs.push(id);
          return Promise.resolve();
        },
        emitSyncSchedule: () => Promise.resolve(),
      } as any,
      {} as any,
      { findOne: () => chain({ firmwareVersion: fw }) } as any,
    );
    (svc as any).redis = { del: () => Promise.resolve() };
    return { svc, sent, syncs };
  };
  // value: grid#?#p#?#energy -> consumption = p + energy
  const frame = (p: number) => `230#50#${p}#48#0#30#48#500`;

  it('sends +1000 encoded shares, skips small moves, stops with -1', async () => {
    const { svc, sent } = make('1.0.18');
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await svc.handleTelemetryForShare({
      currentUid: 'u',
      wifiSsid: 'a',
      data: { value: frame(1000) },
    });
    now.mockReturnValue(1_002_000);
    await svc.handleTelemetryForShare({
      currentUid: 'u',
      wifiSsid: 'b',
      data: { value: frame(2000) },
    });
    expect(sent.slice(-2)).toEqual([
      { id: 'a', value: 2500 },
      { id: 'b', value: 2500 },
    ]);
    const n = sent.length;
    now.mockReturnValue(1_004_000); // +10 W total: under the 30 W deadband
    await svc.handleTelemetryForShare({
      currentUid: 'u',
      wifiSsid: 'a',
      data: { value: frame(1010) },
    });
    expect(sent.length).toBe(n);
    now.mockReturnValue(1_013_000); // 10 s keepalive
    await svc.handleTelemetryForShare({
      currentUid: 'u',
      wifiSsid: 'a',
      data: { value: frame(1010) },
    });
    expect(sent.length).toBe(n + 2);
    // new firmware: the setting fetched over HTTP stays the real one
    expect(await svc.getHardwareSettingValue('u', 'a', '48002000')).toBeNull();
    await svc.deleteGroup('u', '64b7f0c2a1b2c3d4e5f60718');
    expect(sent.slice(-2)).toEqual([
      { id: 'a', value: -1 },
      { id: 'b', value: -1 },
    ]);
    now.mockRestore();
  });

  it('old firmware: no -1, share baked into the HTTP setting', async () => {
    const { svc, sent, syncs } = make('1.0.7');
    await svc.handleTelemetryForShare({
      currentUid: 'u',
      wifiSsid: 'a',
      data: { value: frame(1000) },
    });
    (svc as any).redis = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    };
    expect(await svc.getHardwareSettingValue('u', 'a', '48002000')).toBe(
      '48002000',
    );
    await svc.deleteGroup('u', '64b7f0c2a1b2c3d4e5f60718');
    expect(sent.some((x) => x.value === -1)).toBe(false);
    expect(syncs).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

describe('Legacy shared MQTT account ACL', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { legacyTopicAllowed } = require('./services/mqtt-auth.service');
  it('allows exact per-device topics used by old firmware and old apps', () => {
    for (const t of [
      'inverter/9R1z7JVhQJQYzeQ8RI6Q5M6N7Xq2/GTIControl538/data',
      'inverter/uid/GTIControl1/status',
      'inverter/uid/GTIControl1/cmd/settings',
      'inverter/uid/GTIControl1/stm/ota/status',
      'charger/uid/ChargerControl1369/firmware/update',
      'devices/inverter/uid/GTIControl1',
      // device list of old app/web builds: explicit uid, + for the device
      'inverter/uid/+/data',
      'charger/uid/+/status',
      'devices/inverter/uid/+',
    ]) {
      expect(legacyTopicAllowed(t)).toBe(true);
    }
  });
  it('refuses wildcards and foreign prefixes', () => {
    for (const t of [
      '#',
      '$SYS/#',
      'inverter/#',
      'inverter/+/+/data',
      'inverter/uid/#',
      'inverter/uid/GTIControl1/#',
      'inverter/uid/+/#',
      'inverter/+/GTIControl1/data',
      'homeassistant/sensor/x/config',
      'inverter_ha/uid/dev/set/x',
      'inverter/uid',
      'devices/inverter/+/+',
      '',
    ]) {
      expect(legacyTopicAllowed(t)).toBe(false);
    }
  });
});
