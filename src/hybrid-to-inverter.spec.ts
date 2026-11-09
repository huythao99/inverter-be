/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// Hybrid -> inverter by OTA ("Chuyển về inverter"): id mapping both ways,
// CMS start / cancel, inverter build served by /api/hybrid-firmware, cleanup
// once the unit registers as that inverter.
import {
  HybridConversionService,
  gtiToHybridId,
  hybridToGtiId,
} from './services/hybrid-conversion.service';
import { HybridFirmwareService } from './services/hybrid-firmware.service';
import { setActiveEspFirmware } from './services/firmware.service';

const q = (v: unknown) => ({
  lean: () => q(v),
  exec: () => Promise.resolve(v),
});

function setup(hybridDocs: any[], inverterDocs: any[] = []) {
  const published: any[] = [];
  const revoked: string[] = [];
  const hybrids = {
    findById: (id: string) => q(hybridDocs.find((d) => d._id === id) ?? null),
    updateMany: (f: any, u: any) => {
      for (const d of hybridDocs)
        if (d.deviceId === f.deviceId) Object.assign(d, u.$set);
      return q({});
    },
    find: (f: any) =>
      q(
        hybridDocs.filter(
          (d) =>
            d.inverterConversion?.gtiDeviceId ===
            f['inverterConversion.gtiDeviceId'],
        ),
      ),
    deleteMany: (f: any) => {
      for (let i = hybridDocs.length - 1; i >= 0; i--) {
        if (
          hybridDocs[i].inverterConversion?.gtiDeviceId ===
          f['inverterConversion.gtiDeviceId']
        ) {
          hybridDocs.splice(i, 1);
        }
      }
      return q({});
    },
  };
  const inverters = {
    findOne: (f: any) =>
      q(inverterDocs.find((d) => d.deviceId === f.deviceId) ?? null),
  };
  const mqtt = {
    publishWithRetain: (t: string, p: any, retain: boolean) => {
      published.push({ t, p, retain });
      return Promise.resolve();
    },
  };
  const auth = {
    revokeHybridCredentials: (d: string) => {
      revoked.push(d);
      return Promise.resolve();
    },
  };
  const svc = new HybridConversionService(
    inverters as any,
    hybrids as any,
    {} as any,
    mqtt as any,
    auth as any,
  );
  return { svc, published, revoked, hybridDocs };
}

const native = () => ({
  _id: 'h1',
  userId: 'u1',
  deviceId: 'HybridControl0015',
  firmwareVersion: '1.3.4',
  convertedFrom: null,
  inverterConversion: null,
});
const converted = () => ({
  _id: 'h2',
  userId: 'u1',
  deviceId: 'HybridControl1312',
  firmwareVersion: '1.3.4',
  convertedFrom: 'GTIControl1312',
  inverterConversion: null,
});

describe('ids hybrid <-> inverter', () => {
  it('hybrid flashed as one -> the 90000 range; converted one -> its old id', () => {
    expect(hybridToGtiId('HybridControl0015')).toBe('GTIControl90015');
    expect(hybridToGtiId('HybridControl1312', 'GTIControl1312')).toBe(
      'GTIControl1312',
    );
    expect(hybridToGtiId('HybridControl1312')).toBe('GTIControl91312');
    expect(hybridToGtiId('HybridControl90000')).toBeNull();
    expect(hybridToGtiId('GTIControl1')).toBeNull();
  });

  it('back again: same id as before (what the hybrid firmware does on boot)', () => {
    expect(gtiToHybridId('GTIControl90015')).toBe('HybridControl0015');
    expect(gtiToHybridId('GTIControl91312')).toBe('HybridControl1312');
    expect(gtiToHybridId('GTIControl1312')).toBe('HybridControl1312');
    // Name wrongly kept by inverter 1.1.4 after a rollback: back to the hybrid.
    expect(gtiToHybridId('GTIControl0015')).toBe('HybridControl0015');
    for (const id of [
      'HybridControl0015',
      'HybridControl0001',
      'HybridControl1312',
    ]) {
      expect(gtiToHybridId(hybridToGtiId(id)!)).toBe(id);
    }
  });

  it('the 90000 range never looks like an old Firebase inverter (< 400)', () => {
    expect(
      parseInt(hybridToGtiId('HybridControl0001')!.replace(/\D/g, ''), 10),
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('Chuyển về inverter', () => {
  beforeEach(() =>
    setActiveEspFirmware('inverter', 'stable', {
      version: '1.1.5',
      url: 'https://cdn/inverter-1.1.5.bin',
    }),
  );
  afterAll(() => setActiveEspFirmware('inverter', 'stable', null));

  it('start: flag + CONVERT command (not retained) with the new id', async () => {
    const { svc, published, hybridDocs } = setup([native()]);
    const r = await svc.startToInverter('h1', 'admin');
    expect(r).toMatchObject({
      gtiDeviceId: 'GTIControl90015',
      version: '1.1.5',
    });
    expect(hybridDocs[0].inverterConversion.url).toBe(
      'https://cdn/inverter-1.1.5.bin',
    );
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      t: 'hybrid/u1/HybridControl0015/cmd/action',
      p: { cmd: 'CONVERT', to: 'GTIControl90015' },
      retain: false,
    });
  });

  it('a unit converted from an inverter gets its old id back', async () => {
    const { svc, published } = setup(
      [converted()],
      [{ deviceId: 'GTIControl1312' }],
    );
    await svc.startToInverter('h2');
    expect(published[0].p.to).toBe('GTIControl1312');
  });

  it('refused: id used by a real inverter, old hybrid firmware, inverter build too old', async () => {
    let s = setup([native()], [{ deviceId: 'GTIControl90015' }]);
    await expect(s.svc.startToInverter('h1')).rejects.toThrow(
      'GTIControl90015',
    );
    s = setup([{ ...native(), firmwareVersion: '1.3.3' }]);
    await expect(s.svc.startToInverter('h1')).rejects.toThrow('1.3.4');
    setActiveEspFirmware('inverter', 'stable', { version: '1.1.4', url: 'u' });
    s = setup([native()]);
    await expect(s.svc.startToInverter('h1')).rejects.toThrow('1.1.5');
    expect(s.published).toEqual([]);
  });

  it('cancel clears the flag', async () => {
    const { svc, hybridDocs } = setup([native()]);
    await svc.startToInverter('h1');
    await svc.cancelToInverter('h1');
    expect(hybridDocs[0].inverterConversion).toBeNull();
  });

  it('registered as that inverter: hybrid entry + MQTT account go', async () => {
    const { svc, hybridDocs, revoked } = setup([native(), converted()]);
    await svc.startToInverter('h1');
    await svc.onInverterRegistered({
      userId: 'u1',
      deviceId: 'GTIControl1370',
    }); // unrelated
    expect(hybridDocs).toHaveLength(2);
    await svc.onInverterRegistered({
      userId: 'u1',
      deviceId: 'GTIControl90015',
    });
    expect(hybridDocs.map((d) => d.deviceId)).toEqual(['HybridControl1312']);
    expect(revoked).toEqual(['HybridControl0015']);
  });
});

describe('/api/hybrid-firmware while converting to inverter', () => {
  it('serves the inverter build to that unit only', async () => {
    const model = {
      findOne: (f: any) =>
        q(
          f.deviceId === 'HybridControl0015'
            ? { inverterConversion: { url: 'https://cdn/inverter-1.1.5.bin' } }
            : null,
        ),
    };
    const svc = new HybridFirmwareService(
      {} as any,
      { isBeta: () => false } as any,
      model as any,
    );
    expect(await svc.getFirmwareUrl('HybridControl0015')).toEqual({
      url: 'https://cdn/inverter-1.1.5.bin',
    });
    expect((await svc.getFirmwareUrl('HybridControl0016')).url).not.toContain(
      'inverter-1.1.5',
    );
  });
});
