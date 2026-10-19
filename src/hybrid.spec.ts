/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { MqttAuthService } from './services/mqtt-auth.service';
import { HybridSettingService } from './services/hybrid-setting.service';
import { HybridDataSchema } from './models/hybrid-data.schema';
import {
  hybridGridTieApplied,
  hybridOutFor,
} from './constants/hybrid.constants';
import { AUDIT_EVENT } from './utils/audit-context';
import { HybridDeviceAuthGuard } from './auth/guards/hybrid-device-auth.guard';
import * as crypto from 'crypto';

const chain = (v: unknown) => ({
  exec: () => Promise.resolve(v),
  lean: () => chain(v),
  maxTimeMS: () => chain(v),
});

describe('hybrid grid-tie mapping', () => {
  it('ON -> OUT=INV, OFF -> OUT=BAT', () => {
    expect(hybridOutFor(false)).toBe('INV');
    expect(hybridOutFor(true)).toBe('BAT');
  });

  it('applied: CFG OUT first, then TLM OUT, null without data', () => {
    expect(hybridGridTieApplied(true, { cfgOut: 'BAT', out: 'INV' })).toBe(
      true,
    );
    expect(hybridGridTieApplied(false, { cfgOut: 'BAT' })).toBe(false);
    expect(hybridGridTieApplied(false, { out: 'inv' })).toBe(true);
    expect(hybridGridTieApplied(true, {})).toBeNull();
    expect(hybridGridTieApplied(true, null)).toBeNull();
  });

  it('hybrid data schema has the charger fields', () => {
    for (const f of ['vpv', 'out', 'cfgOut', 'src', 'lastSeenAt']) {
      expect(HybridDataSchema.path(f)).toBeDefined();
    }
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
    ['hybrid/u1/H1/cmd/grid-tie', 'subscribe', true],
    ['hybrid/u1/H1/cmd/settings', 'read', true],
    ['hybrid/u1/H1/firmware/update', 'subscribe', true],
    ['hybrid/u1/H1/cmd/grid-tie', 'write', false],
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

describe('HybridSettingService.setGridTie', () => {
  function setup(doc: unknown) {
    const log: string[] = [];
    const model = {
      findOne: () => chain(doc),
      findOneAndUpdate: (_f: unknown, u: any) => {
        log.push(`db:${JSON.stringify(u.$set.gridTieOff)}`);
        return chain({});
      },
    };
    const mqtt = {
      emitHybridGridTie: (_u: string, d: string, off: boolean) => {
        log.push(`grid-tie:${d}:${off}`);
        return Promise.resolve();
      },
      emitSyncHybridSettings: (_u: string, d: string) => {
        log.push(`settings:${d}`);
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

  it('stores, publishes the retained command and audits a change', async () => {
    const { svc, log } = setup({ value: '05400200', gridTieOff: false });
    const r = await svc.setGridTie('u1', 'H1', true);
    expect(r).toMatchObject({ value: '05400200', gridTieOff: true });
    expect(log).toEqual([
      'db:true',
      'grid-tie:H1:true',
      'settings:H1',
      `${AUDIT_EVENT}:hybrid:grid-tie:0->1`,
    ]);
  });

  it('no audit row when nothing changed (still re-publishes)', async () => {
    const { svc, log } = setup({ value: '', gridTieOff: true });
    await svc.setGridTie('u1', 'H1', true);
    expect(log.some((l) => l.startsWith(AUDIT_EVENT))).toBe(false);
    expect(log).toContain('grid-tie:H1:true');
  });

  it('defaults to grid-tie ON without a stored setting', async () => {
    const { svc } = setup(null);
    expect(await svc.get('u1', 'H1')).toEqual({
      userId: 'u1',
      deviceId: 'H1',
      value: '',
      gridTieOff: false,
    });
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
