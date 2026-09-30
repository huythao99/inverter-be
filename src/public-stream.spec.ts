/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { EventEmitter } from 'events';
import { PublicViewController } from './controllers/device-viewer.controller';

describe('Public link live stream (SSE)', () => {
  const link = { ownerUid: 'OWNER', kind: 'inverter', deviceId: 'GTI1' };
  const ok = (expiresAt: Date | null = null) => ({ status: 'ok', link, expiresAt });
  function setup(
    check: (t: string) => any = (t) => (t === 'T' ? ok() : { status: 'missing' }),
  ) {
    let listener: ((topic: string, p: string) => void) | null = null;
    let topics: string[] = [];
    const stop = jest.fn();
    const streams = {
      acquire: jest.fn(() => true),
      release: jest.fn(),
      listen: jest.fn((t: string[], fn: any) => {
        topics = t;
        listener = fn;
        return stop;
      }),
    };
    const viewers = { checkLink: jest.fn(async (t: string) => check(t)) };
    const ctrl = new PublicViewController(viewers as any, streams as any);
    const out: string[] = [];
    const res = {
      writeHead: jest.fn(),
      write: jest.fn((c: string) => out.push(c)),
      end: jest.fn(),
    };
    const req = new EventEmitter();
    return { ctrl, streams, stop, res, req, out, get: () => ({ listener, topics }) };
  }

  it('relays only that device, never the owner uid in events', async () => {
    const s = setup();
    await s.ctrl.stream('T', s.req as any, s.res as any);
    expect(s.res.writeHead.mock.calls[0][1]['Content-Type']).toContain('text/event-stream');
    expect(s.get().topics).toEqual(['inverter/OWNER/GTI1/data', 'inverter/OWNER/GTI1/status']);
    s.get().listener!('inverter/OWNER/GTI1/data', '{"value":"1#2"}');
    s.get().listener!('inverter/OWNER/GTI1/status', '{"status":"online"}');
    const body = s.out.join('');
    expect(body).toContain('event: data');
    expect(body).toContain('event: status');
    expect(body).not.toContain('OWNER');
    s.req.emit('close');
    expect(s.stop).toHaveBeenCalled();
    expect(s.streams.release).toHaveBeenCalledWith('inverter/OWNER/GTI1');
  });

  it('refuses an unknown link', async () => {
    const s = setup();
    await expect(s.ctrl.stream('BAD', s.req as any, s.res as any)).rejects.toThrow();
    expect(s.streams.listen).not.toHaveBeenCalled();
  });

  it('ends the stream when the link is revoked', async () => {
    jest.useFakeTimers();
    let valid = true;
    const s = setup((t) => (t === 'T' && valid ? ok() : { status: 'missing' }));
    await s.ctrl.stream('T', s.req as any, s.res as any);
    valid = false;
    jest.advanceTimersByTime(30_000);
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    expect(s.out.join('')).toContain('event: revoked');
    expect(s.out.join('')).toContain('"reason":"revoked"');
    expect(s.res.end).toHaveBeenCalled();
    expect(s.stop).toHaveBeenCalled();
  });

  it('refuses an expired link with 410', async () => {
    const s = setup(() => ({ status: 'expired' }));
    await expect(s.ctrl.stream('T', s.req as any, s.res as any)).rejects.toMatchObject({
      status: 410,
    });
  });

  it('ends the stream exactly when the link expires', async () => {
    jest.useFakeTimers();
    const s = setup(() => ok(new Date(Date.now() + 5_000)));
    await s.ctrl.stream('T', s.req as any, s.res as any);
    jest.advanceTimersByTime(5_001);
    jest.useRealTimers();
    expect(s.out.join('')).toContain('"reason":"expired"');
    expect(s.res.end).toHaveBeenCalled();
  });
});

describe('Public link lifetime', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { linkExpiry } = require('./services/device-viewer.service');
  const now = Date.UTC(2026, 0, 1);
  it('defaults to 7 days, 0 = never, only 1/7/30/0 allowed', () => {
    expect(linkExpiry(undefined, now).getTime()).toBe(now + 7 * 86400_000);
    expect(linkExpiry(1, now).getTime()).toBe(now + 86400_000);
    expect(linkExpiry(30, now).getTime()).toBe(now + 30 * 86400_000);
    expect(linkExpiry(0, now)).toBeNull();
    expect(() => linkExpiry(3, now)).toThrow();
    expect(() => linkExpiry('abc', now)).toThrow();
  });
});
