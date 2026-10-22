/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { MqttAuthService } from './services/mqtt-auth.service';
import { HybridSettingService } from './services/hybrid-setting.service';
import { HybridDataSchema } from './models/hybrid-data.schema';
import {
  hybridEnergyDelta,
  hybridPendingKeys,
  hybridSetBody,
  mergeHybridConfig,
  parseHybridPatch,
  vnDay,
} from './constants/hybrid.constants';
import {
  HybridDataService,
  parseHinvlfFrame,
} from './services/hybrid-data.service';
import { AUDIT_EVENT } from './utils/audit-context';
import { buildAuditSummary } from './services/audit-log.service';
import { HybridDeviceAuthGuard } from './auth/guards/hybrid-device-auth.guard';
import * as crypto from 'crypto';

const chain = (v: unknown) => ({
  exec: () => Promise.resolve(v),
  lean: () => chain(v),
  maxTimeMS: () => chain(v),
});

// Sample frames from esp32-hybrid PROTOCOL_HINVLF_V1.md.
const CFG_RAW =
  '$CFG,MODE=EXPORT,PCHG=1000,PEXP=1500,PIMP=10,VEXP=50.0,VCUT=42.0,VRES=44.0,PMAX=4000,PCMAX=3000,VCV=56.5,VOVP=60.0,SYS=48,FHZ=50,VGMAX=250,VGMIN=170,VBMAX=69.9,SRC=LOCAL*8F';
const CFG = parseHinvlfFrame(CFG_RAW)!.items;
const LIMITS = { VCV: 56.5, VBMAX: 69.9 };

describe('HINVLF frames', () => {
  it('parses items, bare words and NAK', () => {
    expect(CFG.PEXP).toBe('1500');
    expect(CFG.SRC).toBe('LOCAL');
    const nak = parseHinvlfFrame('$NAK,SET,ERR=RANGE,KEY=PEXP*00')!;
    expect(nak).toEqual({
      type: 'NAK',
      words: ['SET'],
      items: { ERR: 'RANGE', KEY: 'PEXP' },
    });
    expect(parseHinvlfFrame('*LOCK12345#')).toBeNull();
  });

  it('hybrid data schema keeps tlm / cfg / info maps', () => {
    for (const f of ['tlm', 'cfg', 'info', 'lastNak', 'lastSeenAt']) {
      expect(HybridDataSchema.path(f)).toBeDefined();
    }
  });
});

describe('hybrid config rules', () => {
  const base = parseHybridPatch(CFG).patch;

  it('parses + normalises a patch, rejects unknown keys', () => {
    expect(
      parseHybridPatch({ mode: 'load', PEXP: '1500.4', VCUT: 42.04 }),
    ).toEqual({
      patch: { MODE: 'LOAD', PEXP: 1500, VCUT: 42 },
      errors: [],
    });
    expect(parseHybridPatch({ VCV: 50 }).errors[0].key).toBe('VCV');
    expect(parseHybridPatch({ MODE: 'ZERO' }).errors[0].key).toBe('MODE');
    expect(parseHybridPatch({ PMAX: 'abc' }).errors[0].key).toBe('PMAX');
  });

  it('pull-along: lower PMAX drags PEXP, PCMAX drags PCHG, VRES drags VEXP', () => {
    const r = mergeHybridConfig(
      base,
      { PMAX: 1200, PCMAX: 800, VRES: 51 },
      LIMITS,
    );
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual({
      PMAX: 1200,
      PCMAX: 800,
      VRES: 51,
      PEXP: 1200,
      PCHG: 800,
      VEXP: 51,
    });
  });

  it('no pull-along for a key sent in the same patch: validated instead', () => {
    const r = mergeHybridConfig(base, { PMAX: 1200, PEXP: 1500 }, LIMITS);
    expect(r.errors.map((e) => e.key)).toEqual(['PEXP']);
  });

  it('ranges + cross constraints', () => {
    const keys = (p: object) =>
      mergeHybridConfig(base, p, LIMITS).errors.map((e) => e.key);
    expect(keys({ PMAX: 400 })).toContain('PMAX');
    expect(keys({ PIMP: -600 })).toEqual(['PIMP']);
    expect(keys({ PIMP: -500 })).toEqual([]);
    expect(keys({ VCUT: 43.6 })).toEqual(['VCUT']); // > VRES - 0.5
    expect(keys({ VCUT: 43.5 })).toEqual([]);
    expect(keys({ VRES: 56.1 })).toContain('VRES'); // > VCV - 0.5
    expect(keys({ VEXP: 57 })).toEqual(['VEXP']); // > VCV
    expect(keys({ VEXP: 43 })).toEqual(['VEXP']); // < VRES
    // Moving both thresholds together is fine.
    expect(keys({ VCUT: 46, VRES: 48 })).toEqual([]);
  });

  it('SET body for the firmware + pending keys vs $CFG', () => {
    const c = { MODE: 'LOAD' as const, PEXP: 1500, VCUT: 42, PIMP: -50 };
    expect(hybridSetBody(c)).toBe('MODE=LOAD,PEXP=1500,PIMP=-50,VCUT=42.0');
    expect(hybridSetBody({})).toBe('');
    expect(hybridPendingKeys(c, CFG)).toEqual(['MODE', 'PIMP']);
    expect(hybridPendingKeys(c, null)).toEqual([]);
  });
});

describe('hybrid energy', () => {
  const ref = (UP: number, e: number) => ({
    UP,
    EDIS: e,
    ECHG: e,
    EIMP: e,
    EEXP: e,
  });

  it('delta, wrap at 1e7, STM reboot', () => {
    expect(hybridEnergyDelta(ref(100, 50), ref(103, 52)).EDIS).toBe(2);
    expect(hybridEnergyDelta(ref(100, 9_999_999), ref(103, 3)).EDIS).toBe(4);
    expect(hybridEnergyDelta(ref(5000, 800), ref(4, 1)).EDIS).toBe(1);
    // Rebooted while unseen (UP grew less than the wall time).
    expect(hybridEnergyDelta(ref(5000, 800), ref(5100, 7), 3600).EDIS).toBe(7);
    expect(hybridEnergyDelta(ref(5000, 800), ref(8600, 900), 3600).EDIS).toBe(
      100,
    );
  });

  it('VN day is UTC+7', () => {
    expect(vnDay(new Date('2026-10-22T16:59:00Z'))).toBe('2026-10-22');
    expect(vnDay(new Date('2026-10-22T17:00:00Z'))).toBe('2026-10-23');
  });

  it('accumulates $TLM counters and flushes $inc per day', async () => {
    const writes: any[] = [];
    const sets: any[] = [];
    const model = {
      findOne: () => ({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
      }),
      updateOne: (_f: unknown, u: any) => {
        sets.push(u.$set);
        return { exec: () => Promise.resolve({}) };
      },
    };
    const energyModel = {
      bulkWrite: (ops: any[]) => {
        writes.push(...ops);
        return Promise.resolve({});
      },
    };
    const svc = new HybridDataService(model as any, energyModel as any);
    const tlm = (up: number, edis: number) =>
      `$TLM,DEV=HINVLF,ST=RUN,EDIS=${edis},ECHG=0,EIMP=1,EEXP=0,UP=${up}*00`;
    svc.onData({ userId: 'u', deviceId: 'H', data: { raw: tlm(10, 100) } });
    svc.onData({ userId: 'u', deviceId: 'H', data: { raw: tlm(13, 103) } });
    svc.onData({
      userId: 'u',
      deviceId: 'H',
      data: { raw: '$NAK,SET,ERR=LOCAL*00' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(sets[0].tlm.EDIS).toBe('100');
    expect(sets[2].lastNak).toMatchObject({ of: 'SET', err: 'LOCAL' });
    await svc.flushEnergy();
    expect(writes).toHaveLength(1);
    expect(writes[0].updateOne.update.$inc).toEqual({
      edis: 3,
      echg: 0,
      eimp: 0,
      eexp: 0,
    });
  });
});

describe('MqttAuthService ACL for a hybrid device account', () => {
  const cred = {
    _id: 'c1',
    userId: 'u1',
    kind: 'hybrid',
    deviceId: 'H1',
    mqttUsername: 'hyb_H1',
    isActive: true,
  };
  const model = { findOne: () => chain(cred) };
  const config = { get: (_k: string, d?: unknown) => d } as any;
  const svc = new MqttAuthService(model as any, config);

  it.each([
    ['hybrid/u1/H1/data', 'write', true],
    ['hybrid/u1/H1/status', 'write', true],
    ['hybrid/u1/H1/ota/status', 'write', true],
    ['hybrid/u1/H1/cmd/action', 'subscribe', true],
    ['hybrid/u1/H1/cmd/settings', 'read', true],
    ['hybrid/u1/H1/firmware/update', 'subscribe', true],
    ['hybrid/u1/H1/cmd/action', 'write', false],
    ['hybrid/u1/H1/cmd/grid-tie', 'subscribe', false],
    ['hybrid/u1/H2/data', 'write', false],
    ['hybrid/u2/H1/data', 'write', false],
    ['charger/u1/H1/data', 'write', false],
    ['hybrid/u1/+/data', 'subscribe', false],
  ])('%s %s -> %s', async (topic, acc, ok) => {
    expect(await svc.checkAcl('hyb_H1', topic, acc as any)).toBe(ok);
  });

  it('app account of the owner may read hybrid topics', async () => {
    const app = new MqttAuthService(
      {
        findOne: () => chain({ ...cred, kind: 'app', mqttUsername: 'app_u1' }),
      } as any,
      config,
    );
    expect(await app.checkAcl('app_u1', 'hybrid/u1/H1/data', 'read')).toBe(
      true,
    );
    expect(await app.checkAcl('app_u1', 'hybrid/u2/H1/data', 'read')).toBe(
      false,
    );
  });
});

describe('HybridSettingService', () => {
  function setup(doc: unknown) {
    const log: string[] = [];
    const model = {
      findOne: () => chain(doc),
      updateOne: (_f: unknown, u: any) => {
        log.push(`db:${JSON.stringify(u.$set.config)}`);
        return chain({});
      },
    };
    const mqtt = {
      emitSyncHybridSettings: (_u: string, d: string) => {
        log.push(`settings:${d}`);
        return Promise.resolve();
      },
      emitHybridCommand: (_u: string, d: string, c: string) => {
        log.push(`cmd:${d}:${c}`);
        return Promise.resolve();
      },
    };
    const events = {
      emit: (name: string, e: any) =>
        log.push(`${name}:${e.kind}:${e.action}:${e.before}->${e.after}`),
    };
    const svc = new HybridSettingService(
      model as any,
      mqtt as any,
      events as any,
    );
    return { svc, log };
  }

  it('stores only changed keys, triggers a pull and audits', async () => {
    const { svc, log } = setup({ config: { MODE: 'EXPORT' } });
    const r = await svc.update('u1', 'H1', { PMAX: 1000 }, CFG);
    expect(r.config).toEqual({ MODE: 'EXPORT', PMAX: 1000, PEXP: 1000 });
    expect(r.set).toBe('MODE=EXPORT,PEXP=1000,PMAX=1000');
    expect(log).toEqual([
      'db:{"MODE":"EXPORT","PMAX":1000,"PEXP":1000}',
      'settings:H1',
      `${AUDIT_EVENT}:hybrid:settings:MODE=EXPORT->MODE=EXPORT,PEXP=1000,PMAX=1000`,
    ]);
  });

  it('rejects invalid values with per-key errors, stores nothing', async () => {
    const { svc, log } = setup(null);
    await expect(
      svc.update('u1', 'H1', { VCUT: 4 }, CFG),
    ).rejects.toMatchObject({
      response: { errors: [{ key: 'VCUT' }] },
    });
    expect(log).toEqual([]);
  });

  it('empty without a stored setting', async () => {
    const { svc } = setup(null);
    expect(await svc.get('u1', 'H1')).toMatchObject({ config: {}, set: '' });
  });

  it('commands: only FAULT_RST / STOP / RUN', async () => {
    const { svc, log } = setup(null);
    await svc.command('u1', 'H1', 'fault_rst');
    expect(log).toEqual([
      'cmd:H1:FAULT_RST',
      `${AUDIT_EVENT}:hybrid:command:null->FAULT_RST`,
    ]);
    await expect(svc.command('u1', 'H1', 'SAVE')).rejects.toThrow();
  });
});

describe('HybridDeviceAuthGuard (firmware HTTP calls)', () => {
  const hash = (p: string) =>
    crypto.createHash('sha256').update(p).digest('hex');
  const cred = {
    userId: 'u1',
    kind: 'hybrid',
    deviceId: 'H1',
    mqttUsername: 'hyb_H1',
    mqttPasswordHash: hash('secret'),
    isActive: true,
  };
  const model = {
    findOne: (f: any) =>
      chain(f.mqttUsername === 'hyb_H1' && f.kind === 'hybrid' ? cred : null),
  };
  const config = { get: (_k: string, d?: unknown) => d } as any;
  const guard = new HybridDeviceAuthGuard(
    new MqttAuthService(model as any, config),
  );
  const ctx = (auth: string | undefined, params: any, query: any = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: auth ? { authorization: auth } : {},
          params,
          query,
        }),
      }),
    }) as any;
  const basic = (u: string, p: string) =>
    'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

  it('accepts the own account on its own device', async () => {
    await expect(
      guard.canActivate(
        ctx(basic('hyb_H1', 'secret'), { userId: 'u1', deviceId: 'H1' }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx(basic('hyb_H1', 'secret'), {}, { deviceId: 'H1' })),
    ).resolves.toBe(true);
  });

  it.each([
    ['no header', undefined, { userId: 'u1', deviceId: 'H1' }],
    [
      'wrong password',
      basic('hyb_H1', 'nope'),
      { userId: 'u1', deviceId: 'H1' },
    ],
    [
      'other device',
      basic('hyb_H1', 'secret'),
      { userId: 'u1', deviceId: 'H2' },
    ],
    [
      'other owner',
      basic('hyb_H1', 'secret'),
      { userId: 'u2', deviceId: 'H1' },
    ],
    [
      'unknown account',
      basic('chg_H1', 'secret'),
      { userId: 'u1', deviceId: 'H1' },
    ],
  ])('rejects: %s', async (_n, auth, params) => {
    await expect(guard.canActivate(ctx(auth, params))).rejects.toThrow();
  });
});

describe('hybrid audit summary', () => {
  it('lists changed keys and commands in Vietnamese', () => {
    expect(
      buildAuditSummary({
        kind: 'hybrid',
        action: 'settings',
        before: 'MODE=EXPORT,PEXP=1500',
        after: 'MODE=LOAD,PEXP=1500,VCUT=42.0',
      }),
    ).toBe('Chế độ: Đẩy lưới → Bám tải; Pin ngắt xả: — → 42.0 V');
    expect(
      buildAuditSummary({
        kind: 'hybrid',
        action: 'command',
        before: null,
        after: 'FAULT_RST',
      }),
    ).toBe('Xóa lỗi');
  });
});
