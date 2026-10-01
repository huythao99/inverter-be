/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  frameShowsGridTieOff,
  GRID_TIE_RESYNC_FAST_TRIES,
  GridTieSyncService,
} from './services/grid-tie-sync.service';

const lean = (v: unknown) => ({
  select: () => lean(v),
  lean: () => ({ exec: () => Promise.resolve(v) }),
});

const OBEYS = '230.1#50.0#120#52.1#0#41.2#99.00#1';
const IGNORES = '230.1#50.0#120#52.1#998#41.2#51.00#1000';

function setup(offRows: unknown[] = []) {
  const log: string[] = [];
  const mqtt = {
    isConnected: () => true,
    emitGridTie: (_u: string, d: string, off: boolean) => {
      log.push(`${d}:grid-tie:${off}`);
      return Promise.resolve();
    },
    emitSyncSettings: (_u: string, d: string) => {
      log.push(`${d}:settings`);
      return Promise.resolve();
    },
    emitSyncSchedule: (_u: string, d: string) => {
      log.push(`${d}:schedule`);
      return Promise.resolve();
    },
  };
  const settings = { find: () => lean(offRows) };
  const svc = new GridTieSyncService(settings as any, mqtt as any);
  const frame = (value: string, d = 'D') =>
    svc.onTelemetry({ currentUid: 'u', wifiSsid: d, data: { value } });
  const age = (ms: number, d = 'D') => {
    const r = (svc as any).resync.get(`u:${d}`);
    if (r) r.at -= ms;
  };
  return { svc, log, frame, age };
}

describe('grid-tie OFF delivery', () => {
  it('reads the applied cut-off / limit from the frame', () => {
    expect(frameShowsGridTieOff(OBEYS)).toBe(true);
    expect(frameShowsGridTieOff(`$${OBEYS}#0#0`)).toBe(true);
    expect(frameShowsGridTieOff(IGNORES)).toBe(false);
    expect(frameShowsGridTieOff('1#2#3')).toBeNull();
    expect(frameShowsGridTieOff(undefined)).toBeNull();
  });

  it('toggle publishes the retained command, never share', async () => {
    const { svc, log } = setup();
    await svc.onGridTieChanged({ userId: 'u', deviceId: 'D', off: true });
    await svc.onGridTieChanged({ userId: 'u', deviceId: 'D', off: false });
    expect(log).toEqual(['D:grid-tie:true', 'D:grid-tie:false']);
  });

  it('device ignoring OFF: re-sync after 30 s, not on every frame', async () => {
    const { svc, log, frame, age } = setup();
    await svc.onGridTieChanged({ userId: 'u', deviceId: 'D', off: true });
    log.length = 0;
    await frame(IGNORES); // first seen: wait
    await frame(IGNORES);
    expect(log).toEqual([]);
    age(31_000);
    await frame(IGNORES);
    expect(log).toEqual(['D:settings', 'D:schedule', 'D:grid-tie:true']);
    await frame(IGNORES); // < 30 s again
    expect(log).toHaveLength(3);
  });

  it('slows down after repeated failures', async () => {
    const { svc, log, frame, age } = setup();
    await svc.onGridTieChanged({ userId: 'u', deviceId: 'D', off: true });
    await frame(IGNORES);
    for (let i = 0; i < GRID_TIE_RESYNC_FAST_TRIES; i++) {
      age(31_000);
      await frame(IGNORES);
    }
    log.length = 0;
    age(31_000);
    await frame(IGNORES);
    expect(log).toEqual([]); // now every 10 min
    age(10 * 60_000);
    await frame(IGNORES);
    expect(log).toHaveLength(3);
  });

  it('obeying device or ON device: nothing sent', async () => {
    const { svc, log, frame, age } = setup();
    await frame(IGNORES, 'ON');
    await svc.onGridTieChanged({ userId: 'u', deviceId: 'D', off: true });
    log.length = 0;
    await frame(OBEYS);
    age(60_000);
    await frame(OBEYS);
    expect(log).toEqual([]);
  });

  it('reload: OFF devices from MongoDB, retained command seeded once', async () => {
    const { svc, log } = setup([{ userId: 'u', deviceId: 'X' }]);
    await svc.reload();
    await svc.reload();
    expect(svc.isOff('u', 'X')).toBe(true);
    expect(log).toEqual(['X:grid-tie:true']);
  });
});
