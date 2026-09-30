/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { EventEmitter } from 'events';
import { PublicViewController } from './controllers/device-viewer.controller';

describe('Public link live stream (SSE)', () => {
  const link = { ownerUid: 'OWNER', kind: 'inverter', deviceId: 'GTI1' };
  function setup(resolve: (t: string) => any = (t) => (t === 'T' ? link : null)) {
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
    const viewers = { resolveLink: jest.fn(async (t: string) => resolve(t)) };
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
    const s = setup((t) => (t === 'T' && valid ? link : null));
    await s.ctrl.stream('T', s.req as any, s.res as any);
    valid = false;
    jest.advanceTimersByTime(30_000);
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    expect(s.out.join('')).toContain('event: revoked');
    expect(s.res.end).toHaveBeenCalled();
    expect(s.stop).toHaveBeenCalled();
  });
});
