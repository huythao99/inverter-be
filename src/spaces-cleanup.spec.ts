/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { SpacesCleanupService } from './services/spaces-cleanup.service';

const exec = (v: unknown) => ({ exec: () => Promise.resolve(v) });

function setup(opts: { reuploaded?: boolean; failDelete?: boolean } = {}) {
  const jobs: any[] = [];
  const pending = {
    create: (d: any) => {
      jobs.push({ _id: String(jobs.length + 1), attempts: 0, ...d });
      return Promise.resolve();
    },
    find: (q: any) => ({
      limit: () =>
        exec(jobs.filter((j) => j.deleteAfter <= q.deleteAfter.$lte)),
    }),
    deleteOne: (q: any) => {
      const i = jobs.findIndex((j) => j._id === q._id);
      if (i >= 0) jobs.splice(i, 1);
      return exec({});
    },
    updateOne: (q: any, u: any) => {
      Object.assign(
        jobs.find((j) => j._id === q._id),
        u,
      );
      return exec({});
    },
  };
  const exists = () => exec(opts.reuploaded ? { _id: 'x' } : null);
  const connection = {
    models: { EspFirmware: { exists }, StmFirmware: { exists } },
  };
  const deleted: string[] = [];
  const spaces = {
    enabled: true,
    deleteObject: (k: string) => {
      if (opts.failDelete) return Promise.reject(new Error('boom'));
      deleted.push(k);
      return Promise.resolve();
    },
  };
  const config = { get: () => '60' };
  const svc = new SpacesCleanupService(
    pending as any,
    connection as any,
    spaces as any,
    config as any,
  );
  return { svc, jobs, deleted };
}

describe('Spaces cleanup after a CMS delete', () => {
  it('waits for the delay, then deletes the files', async () => {
    const { svc, jobs, deleted } = setup();
    expect(
      await svc.schedule('esp', 'inverter', '1.1.1', ['a/firmware.bin']),
    ).toBe(true);
    expect(await svc.runDue(new Date())).toBe(0);
    expect(deleted).toEqual([]);
    const later = new Date(Date.now() + 61 * 60_000);
    expect(await svc.runDue(later)).toBe(1);
    expect(deleted).toEqual(['a/firmware.bin']);
    expect(jobs).toHaveLength(0);
  });

  it('keeps the file when the same version was uploaded again', async () => {
    const { svc, jobs, deleted } = setup({ reuploaded: true });
    await svc.schedule('stm', 'inverter', '3.4.1', ['x/app.bin', 'x/app.json']);
    await svc.runDue(new Date(Date.now() + 61 * 60_000));
    expect(deleted).toEqual([]);
    expect(jobs).toHaveLength(0);
  });

  it('retries later when Spaces fails', async () => {
    const { svc, jobs } = setup({ failDelete: true });
    await svc.schedule('esp', 'charger', '1.0.3', ['c/firmware.bin']);
    const t = new Date(Date.now() + 61 * 60_000);
    await svc.runDue(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].attempts).toBe(1);
    expect(jobs[0].deleteAfter.getTime()).toBeGreaterThan(t.getTime());
  });

  it('CMS delete: files removed right away', async () => {
    const { svc, jobs, deleted } = setup();
    expect(
      await svc.deleteNow('stm', 'inverter', '3.4.1', [
        'x/app.bin',
        'x/app.json',
      ]),
    ).toBe('deleted');
    expect(deleted).toEqual(['x/app.bin', 'x/app.json']);
    expect(jobs).toHaveLength(0);
  });

  it('CMS delete: a file Spaces refuses is retried a few minutes later', async () => {
    const { svc, jobs } = setup({ failDelete: true });
    expect(
      await svc.deleteNow('esp', 'inverter', '1.1.1', ['a/firmware.bin']),
    ).toBe('queued');
    expect(jobs).toHaveLength(1);
    const wait = jobs[0].deleteAfter.getTime() - Date.now();
    expect(wait).toBeGreaterThan(60_000);
    expect(wait).toBeLessThanOrEqual(5 * 60_000);
  });
});
