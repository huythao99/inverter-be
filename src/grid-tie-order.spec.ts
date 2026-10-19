/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { GridTieService } from './services/grid-tie.service';

// Turning grid-tie ON/OFF makes the device re-fetch its setting at once
// (published from setGridTieOffInDb). The cached status must already be the
// new one by then, else GET setting serves the stale state.
describe('GridTieService.setGridTie ordering', () => {
  function setup(dbFails = false) {
    const store = new Map<string, string>();
    const seenAtDbWrite: string[] = [];
    const redis = {
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      },
      del: (k: string) => {
        store.delete(k);
        return Promise.resolve(1);
      },
    };
    const settings = {
      setGridTieOffInDb: () => {
        seenAtDbWrite.push(store.get('grid_tie:u:D') ?? 'none');
        return dbFails
          ? Promise.reject(new Error('db down'))
          : Promise.resolve({});
      },
      getGridTieOffFromDb: () => Promise.resolve(false),
    };
    const svc = new GridTieService({} as any, settings as any);
    (svc as any).redis = redis;
    return { svc, store, seenAtDbWrite };
  }

  it('cache holds the new status before the DB write (and its re-sync)', async () => {
    const { svc, store, seenAtDbWrite } = setup();
    store.set('grid_tie:u:D', '1');
    await svc.setGridTie('u', 'D', false);
    expect(seenAtDbWrite).toEqual(['0']);
    expect(await svc.isOff('u', 'D')).toBe(false);
  });

  it('DB failure drops the cache entry', async () => {
    const { svc, store } = setup(true);
    await expect(svc.setGridTie('u', 'D', true)).rejects.toThrow('db down');
    expect(store.has('grid_tie:u:D')).toBe(false);
  });
});
