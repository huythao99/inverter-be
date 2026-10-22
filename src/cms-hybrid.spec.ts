/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { CmsHybridService } from './services/cms-hybrid.service';

const q = (v: unknown) => {
  const c: any = {
    sort: () => c,
    skip: () => c,
    limit: () => c,
    select: () => c,
    lean: () => c,
    exec: () => Promise.resolve(v),
  };
  return c;
};

function setup(devices: any[], datas: any[]) {
  const seen: any = {};
  const deviceModel = {
    find: (f: any) => {
      seen.deviceFilter = f;
      return q(devices);
    },
    countDocuments: () => q(devices.length),
  };
  const dataModel = {
    find: (f: any) => {
      seen.dataFilters = [...(seen.dataFilters ?? []), f];
      return q(datas);
    },
  };
  const users = {
    uidForSearch: (s: string) =>
      Promise.resolve(s.includes('@') ? 'U-MAIL' : null),
    withOwners: (rows: any[]) =>
      Promise.resolve(rows.map((r) => ({ ...r, ownerEmail: 'a@b.c' }))),
  };
  const svc = new CmsHybridService(
    deviceModel as any,
    dataModel as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    users as any,
  );
  return { svc, seen };
}

describe('CmsHybridService.getDevices', () => {
  const now = new Date();
  const dev = {
    userId: 'u1',
    deviceId: 'HybridControl1001',
    deviceName: 'Nhà A',
  };
  const data = {
    userId: 'u1',
    deviceId: 'HybridControl1001',
    lastSeenAt: now,
    tlm: {
      ST: 'FLT',
      MODE: 'LOAD',
      FLT: '4',
      LOCK: '1',
      SRC: 'ESP',
      VBAT: '41.9',
    },
    info: { FW: '5.4.3' },
  };

  it('searches id / name / uid / owner email, regex escaped', async () => {
    const { svc, seen } = setup([dev], [data]);
    await svc.getDevices({ search: 'a@b.c', page: 1, limit: 20 });
    const or = seen.deviceFilter.$or;
    expect(or[0].deviceId.$regex).toBe('a@b\\.c');
    expect(or).toContainEqual({ userId: 'U-MAIL' });
  });

  it('adds a live summary per row', async () => {
    const { svc } = setup([dev], [data]);
    const r = await svc.getDevices({ page: 1, limit: 20 });
    expect(r.total).toBe(1);
    expect(r.data[0]).toMatchObject({
      ownerEmail: 'a@b.c',
      summary: {
        online: true,
        st: 'FLT',
        mode: 'LOAD',
        flt: '4',
        lock: true,
        src: 'ESP',
        stmFw: '5.4.3',
      },
    });
  });

  it('status=fault / offline filter by the data collection', async () => {
    const a = setup([dev], [data]);
    await a.svc.getDevices({ status: 'fault', page: 1, limit: 20 });
    expect(a.seen.dataFilters[0]['tlm.FLT']).toBeDefined();
    expect(a.seen.deviceFilter.$and[0]).toEqual({
      $or: [{ userId: 'u1', deviceId: 'HybridControl1001' }],
    });
    const b = setup([dev], [data]);
    await b.svc.getDevices({ status: 'offline', page: 1, limit: 20 });
    expect(b.seen.deviceFilter.$and[0]).toEqual({
      $nor: [{ userId: 'u1', deviceId: 'HybridControl1001' }],
    });
    const c = setup([dev], []);
    await c.svc.getDevices({ status: 'online', page: 1, limit: 20 });
    expect(c.seen.deviceFilter.$and[0]).toEqual({ _id: null });
  });
});
