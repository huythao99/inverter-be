/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
// Inverter -> hybrid by OTA (ESP32 only): CMS start / cancel, the hybrid
// build served by GET /api/firmware, cleanup once added again as a hybrid.
import {
  HYBRID_CONVERT_MAX_BYTES,
  HybridConversionService,
  gtiToHybridId,
} from './services/hybrid-conversion.service';
import { FirmwareService } from './services/firmware.service';
import { InverterDeviceService } from './services/inverter-device.service';

const q = (v: unknown) => ({
  lean: () => q(v),
  exec: () => Promise.resolve(v),
});

function setup(opts: { fw?: any; hybridExists?: boolean } = {}) {
  const inverterDocs: any[] = [
    {
      _id: 'i1',
      userId: 'u1',
      deviceId: 'GTIControl1230',
      hybridConversion: null,
    },
    {
      _id: 'i2',
      userId: 'u2',
      deviceId: 'GTIControl1230',
      hybridConversion: null,
    },
    {
      _id: 'i3',
      userId: 'u1',
      deviceId: 'GTIControl9',
      hybridConversion: null,
    },
    // Converted with 1.3.1, rolled back to the inverter firmware (new name).
    {
      _id: 'i4',
      userId: 'u1',
      deviceId: 'HybridControl77',
      hybridConversion: null,
    },
  ];
  const deleted: any[] = [];
  const inverters = {
    docs: inverterDocs,
    findById: (id: string) => q(inverterDocs.find((d) => d._id === id) ?? null),
    updateMany: (f: any, u: any) => {
      for (const d of inverterDocs)
        if (d.deviceId === f.deviceId) Object.assign(d, u.$set);
      return q({});
    },
    findOne: (f: any) =>
      q(
        inverterDocs.find(
          (d) => f.deviceId.$in.includes(d.deviceId) && d.hybridConversion,
        ) ?? null,
      ),
    deleteMany: (f: any) => {
      const match = (d: any, c: any) =>
        (typeof c.deviceId === 'string'
          ? d.deviceId === c.deviceId
          : c.deviceId.$in.includes(d.deviceId)) &&
        (!('hybridConversion' in c) || d.hybridConversion);
      const hit = inverterDocs.filter((d) =>
        f.$or.some((c: any) => match(d, c)),
      );
      deleted.push(...hit);
      return q({ deletedCount: hit.length });
    },
  };
  const hybridUpdates: any[] = [];
  const hybrids = {
    exists: () => q(opts.hybridExists ? { _id: 'h' } : null),
    updateMany: (f: any, u: any) => {
      hybridUpdates.push({ f, u });
      return q({});
    },
  };
  const fw =
    'fw' in opts
      ? opts.fw
      : {
          version: '1.3.5',
          url: 'https://cdn/hybrid-1.3.5.bin',
          size: 1_142_500,
        };
  const firmwares = { findOne: () => q(fw) };
  const published: any[] = [];
  const mqtt = {
    publish: (t: string, p: any) => {
      published.push({ t, p });
      return Promise.resolve();
    },
  };
  const svc = new HybridConversionService(
    inverters as any,
    hybrids as any,
    firmwares as any,
    mqtt as any,
    {} as any,
  );
  return { svc, inverterDocs, published, deleted, hybridUpdates };
}

describe('inverter -> hybrid conversion', () => {
  it('same number, hybrid prefix', () => {
    expect(gtiToHybridId('GTIControl1230')).toBe('HybridControl1230');
    expect(gtiToHybridId('GTIControl0007')).toBe('HybridControl0007');
    for (const bad of [
      'HybridControl12',
      'ChargerControl1',
      'GTIControl',
      'GTIControl12a',
      '1230',
      '',
    ]) {
      expect(gtiToHybridId(bad)).toBeNull();
    }
  });

  it('start: every account of the device is flagged, OTA trigger sent', async () => {
    const { svc, inverterDocs, published } = setup();
    const r = await svc.start('i1', 'admin');
    expect(r).toMatchObject({
      deviceId: 'GTIControl1230',
      hybridDeviceId: 'HybridControl1230',
      version: '1.3.5',
      by: 'admin',
    });
    expect(inverterDocs[0].hybridConversion?.url).toBe(
      'https://cdn/hybrid-1.3.5.bin',
    );
    expect(inverterDocs[1].hybridConversion?.url).toBe(
      'https://cdn/hybrid-1.3.5.bin',
    );
    expect(inverterDocs[2].hybridConversion).toBeNull();
    expect(published).toHaveLength(1);
    expect(published[0].t).toBe('inverter/u1/GTIControl1230/firmware/update');
    expect(Object.keys(published[0].p)).toEqual(['ts']); // short: old MQTT buffer
  });

  it('refused: number already used by a hybrid', async () => {
    const { svc, published } = setup({ hybridExists: true });
    await expect(svc.start('i1')).rejects.toThrow('HybridControl1230');
    expect(published).toEqual([]);
  });

  it('refused: no stable hybrid build, too old, or too big for the inverter slot', async () => {
    for (const fw of [
      null,
      { version: '1.3.4', url: 'u', size: 1000 }, // rolled back before being added
      { version: '1.4.0', url: 'u', size: HYBRID_CONVERT_MAX_BYTES + 1 },
    ]) {
      const { svc, published, inverterDocs } = setup({ fw });
      await expect(svc.start('i1')).rejects.toThrow();
      expect(published).toEqual([]);
      expect(inverterDocs[0].hybridConversion).toBeNull();
    }
    const ok = setup({
      fw: { version: '1.10.0', url: 'u', size: HYBRID_CONVERT_MAX_BYTES },
    });
    await expect(ok.svc.start('i1')).resolves.toBeDefined();
  });

  it('refused: unknown device or not an inverter id', async () => {
    const { svc } = setup();
    await expect(svc.start('nope')).rejects.toThrow();
  });

  it('cancel clears the flag on every account', async () => {
    const { svc, inverterDocs } = setup();
    await svc.start('i1');
    await svc.cancel('i2');
    expect(inverterDocs[0].hybridConversion).toBeNull();
    expect(inverterDocs[1].hybridConversion).toBeNull();
  });

  it('added again as HybridControl1230: the old inverter entries go', async () => {
    const { svc, deleted } = setup();
    await svc.onHybridProvisioned({
      userId: 'u1',
      deviceId: 'HybridControl1230',
    }); // not converting
    expect(deleted).toEqual([]);
    await svc.start('i1');
    await svc.onHybridProvisioned({
      userId: 'u1',
      deviceId: 'HybridControl0001',
    });
    expect(deleted).toEqual([]);
    await svc.onHybridProvisioned({
      userId: 'u1',
      deviceId: 'HybridControl1230',
    });
    expect(deleted.map((d) => d._id).sort()).toEqual(['i1', 'i2']);
  });
  it('rolled back (inverter entry named HybridControlN): converted again, same id', async () => {
    const { svc, inverterDocs, published } = setup({ hybridExists: true });
    const r = await svc.start('i4');
    expect(r.hybridDeviceId).toBe('HybridControl77');
    expect(inverterDocs[3].hybridConversion?.url).toBe(
      'https://cdn/hybrid-1.3.5.bin',
    );
    expect(published[0].t).toBe('inverter/u1/HybridControl77/firmware/update');
  });

  it('added as a hybrid: its rolled-back inverter entry goes too', async () => {
    const { svc, deleted } = setup();
    await svc.onHybridProvisioned({
      userId: 'u1',
      deviceId: 'HybridControl77',
    });
    expect(deleted.map((d) => d._id)).toEqual(['i4']);
  });
});

describe('GET /api/firmware while converting', () => {
  it('serves the hybrid build to that device only', async () => {
    const model = {
      findOne: (f: any) =>
        q(
          f.deviceId === 'GTIControl1230'
            ? {
                hybridConversion: {
                  url: 'https://cdn/hyb.bin',
                  version: '1.3.5',
                },
              }
            : null,
        ),
      find: () => q([]),
    };
    const inv = new InverterDeviceService(model as any, {} as any, {} as any);
    const beta = { isBeta: () => false };
    const svc = new FirmwareService(inv, beta as any);
    expect(await svc.getFirmwareUrl('GTIControl1230')).toEqual({
      url: 'https://cdn/hyb.bin',
    });
    expect((await svc.getFirmwareUrl('GTIControl1231')).url).not.toBe(
      'https://cdn/hyb.bin',
    );
  });
});
