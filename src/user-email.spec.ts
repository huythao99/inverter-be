/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { UserEmailService } from './services/user-email.service';

function setup(opts: { fail?: boolean; noFirebase?: boolean } = {}) {
  let calls = 0;
  const auth = {
    getUsers: (ids: Array<{ uid: string }>) => {
      calls++;
      if (opts.fail) return Promise.reject(new Error('quota'));
      return Promise.resolve({
        users: ids
          .filter((i) => i.uid !== 'gone')
          .map((i) => ({ uid: i.uid, email: `${i.uid}@mail.com` })),
      });
    },
    getUserByEmail: (email: string) =>
      email === 'a@mail.com'
        ? Promise.resolve({ uid: 'a' })
        : Promise.reject(new Error('auth/user-not-found')),
  };
  const firebase = {
    getAuth: () => {
      if (opts.noFirebase) throw new Error('Firebase not initialized');
      return auth;
    },
  };
  const svc = new UserEmailService(firebase as any);
  return { svc, calls: () => calls };
}

describe('device owner email for the CMS', () => {
  it('adds the owner email to rows, cached (misses too)', async () => {
    const { svc, calls } = setup();
    const rows = [
      { userId: 'a', deviceId: 'D1' },
      { userId: 'a', deviceId: 'D2' },
      { userId: 'gone', deviceId: 'D3' },
    ];
    const out = await svc.withOwners(rows);
    expect(out.map((r) => r.ownerEmail)).toEqual([
      'a@mail.com',
      'a@mail.com',
      null,
    ]);
    expect(out[0].deviceId).toBe('D1');
    await svc.withOwners(rows);
    expect(calls()).toBe(1);
  });

  it('never throws: Firebase error or not configured -> null', async () => {
    for (const opts of [{ fail: true }, { noFirebase: true }]) {
      const { svc } = setup(opts);
      const out = await svc.withOwners([{ userId: 'a' }]);
      expect(out[0].ownerEmail).toBeNull();
    }
  });

  it('a search that is an email -> its uid', async () => {
    const { svc } = setup();
    expect(await svc.uidForSearch('a@mail.com')).toBe('a');
    expect(await svc.uidForSearch('x@mail.com')).toBeNull();
    expect(await svc.uidForSearch('GTIControl12')).toBeNull();
  });
});
