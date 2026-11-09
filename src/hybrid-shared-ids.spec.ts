/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// Duplicate hybrid ids (two units flashed with the same number, owned by
// different accounts): with HYBRID_EXCLUSIVE_OWNER off they no longer take
// each other's list entry or broker account.
import * as crypto from 'crypto';
import { MqttAuthService } from './services/mqtt-auth.service';
import { HybridDeviceService } from './services/hybrid-device.service';

const q = (v: unknown) => ({
  lean: () => q(v),
  exec: () => Promise.resolve(v),
});
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** In-memory collections for devices, claims and broker accounts. */
function world() {
  const devices: any[] = [];
  const creds: any[] = [];
  const claims = [
    {
      codeHash: hash('A'),
      userId: 'uA',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    },
    {
      codeHash: hash('B'),
      userId: 'uB',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    },
  ];
  const matches = (d: any, f: any) =>
    Object.entries(f).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && '$ne' in v ? d[k] !== v.$ne : d[k] === v,
    );
  const deviceModel = {
    deleteMany: (f: any) => {
      const before = devices.length;
      for (let i = devices.length - 1; i >= 0; i--)
        if (matches(devices[i], f)) devices.splice(i, 1);
      return q({ deletedCount: before - devices.length });
    },
    exists: (f: any) =>
      q(devices.some((d) => matches(d, f)) ? { _id: 'x' } : null),
    findOneAndUpdate: (f: any, u: any) => {
      let d = devices.find((x) => matches(x, f));
      if (!d) devices.push((d = { ...f, ...u.$setOnInsert }));
      Object.assign(d, u.$set);
      return q(d);
    },
  };
  const claimModel = {
    findOneAndUpdate: (f: any, u: any) => {
      const c = claims.find((x) => x.codeHash === f.codeHash);
      if (c) Object.assign(c, u.$set);
      return q(c ?? null);
    },
  };
  const credModel = {
    findOneAndUpdate: (f: any, u: any) => {
      let c = creds.find((x) => x.mqttUsername === f.mqttUsername);
      if (!c) creds.push((c = {}));
      Object.assign(c, u);
      return q(c);
    },
    deleteMany: (f: any) => {
      const before = creds.length;
      for (let i = creds.length - 1; i >= 0; i--)
        if (matches(creds[i], f)) creds.splice(i, 1);
      return q({ deletedCount: before - creds.length });
    },
    findOne: (f: any) =>
      q(
        creds.find((c) => c.mqttUsername === f.mqttUsername && c.isActive) ??
          null,
      ),
  };
  const auth = new MqttAuthService(
    credModel as any,
    { get: (_k: string, d?: unknown) => d } as any,
  );
  const svc = new HybridDeviceService(
    deviceModel as any,
    claimModel as any,
    auth,
  );
  return { svc, auth, devices, creds };
}

describe('duplicate hybrid ids', () => {
  const env = process.env.HYBRID_EXCLUSIVE_OWNER;
  afterEach(() => {
    if (env === undefined) delete process.env.HYBRID_EXCLUSIVE_OWNER;
    else process.env.HYBRID_EXCLUSIVE_OWNER = env;
  });

  it('default (shared): both owners keep the unit, each with its own account', async () => {
    delete process.env.HYBRID_EXCLUSIVE_OWNER;
    const { svc, auth, devices, creds } = world();
    const a = await svc.provision('HybridControl0020', 'A');
    const b = await svc.provision('HybridControl0020', 'B');
    expect(devices.map((d) => d.userId).sort()).toEqual(['uA', 'uB']);
    expect(a.mqttUsername).not.toBe(b.mqttUsername);
    expect(creds).toHaveLength(2);
    // A's unit still logs in, with A's topics only.
    expect(
      await auth.verifyDeviceCredentials(
        'hybrid',
        a.mqttUsername,
        a.mqttPassword,
      ),
    ).toEqual({
      userId: 'uA',
      deviceId: 'HybridControl0020',
    });
    expect(
      await auth.checkAcl(
        a.mqttUsername,
        'hybrid/uA/HybridControl0020/data',
        'write',
      ),
    ).toBe(true);
    expect(
      await auth.checkAcl(
        a.mqttUsername,
        'hybrid/uB/HybridControl0020/data',
        'write',
      ),
    ).toBe(false);
  });

  it('HYBRID_EXCLUSIVE_OWNER=1: the old behaviour (moved to the new owner)', async () => {
    process.env.HYBRID_EXCLUSIVE_OWNER = '1';
    const { svc, auth, devices, creds } = world();
    const a = await svc.provision('HybridControl0020', 'A');
    const b = await svc.provision('HybridControl0020', 'B');
    expect(devices.map((d) => d.userId)).toEqual(['uB']);
    expect(a.mqttUsername).toBe('hyb_HybridControl0020');
    expect(b.mqttUsername).toBe('hyb_HybridControl0020');
    expect(creds).toHaveLength(1);
    expect(
      await auth.verifyDeviceCredentials(
        'hybrid',
        a.mqttUsername,
        a.mqttPassword,
      ),
    ).toBeNull();
  });

  it('re-adding to the same account replaces its old-scheme account', async () => {
    process.env.HYBRID_EXCLUSIVE_OWNER = '1';
    const w = world();
    await w.svc.provision('HybridControl0020', 'A'); // hyb_HybridControl0020
    delete process.env.HYBRID_EXCLUSIVE_OWNER;
    // A fresh code for uA (the first one is used by this same device: allowed).
    const r = await w.svc.provision('HybridControl0020', 'A');
    expect(r.mqttUsername).toMatch(/^hyb_HybridControl0020_[0-9a-f]{8}$/);
    expect(w.creds.map((c) => c.mqttUsername)).toEqual([r.mqttUsername]);
  });

  it('removing the unit from one account revokes only that account', async () => {
    delete process.env.HYBRID_EXCLUSIVE_OWNER;
    const { svc, auth, creds } = world();
    await svc.provision('HybridControl0020', 'A');
    const b = await svc.provision('HybridControl0020', 'B');
    await auth.revokeHybridCredentials('HybridControl0020', 'uA');
    expect(creds.map((c) => c.mqttUsername)).toEqual([b.mqttUsername]);
  });
});
