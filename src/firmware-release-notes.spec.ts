/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { EspFirmwareService } from './services/esp-firmware.service';

function make(docs: unknown[]) {
  let finds = 0;
  const chain = (v: unknown) => ({
    lean: () => chain(v),
    maxTimeMS: () => chain(v),
    exec: () => Promise.resolve(v),
  });
  const model = {
    find: () => {
      finds++;
      return chain(docs);
    },
  };
  const config = { get: (_k: string, d: string) => d };
  const svc = new EspFirmwareService(
    model as any,
    {} as any,
    {} as any,
    config as any,
  );
  return { svc, finds: () => finds };
}

describe('firmware release notes for users', () => {
  const docs = [
    {
      version: '1.1.4',
      releaseNotes: 'Sửa lỗi A',
      createdAt: new Date('2026-09-01'),
    },
    {
      version: '1.1.10',
      releaseNotes: ' Thêm B \n',
      createdAt: new Date('2026-10-01'),
    },
    {
      version: '1.1.6',
      releaseNotes: 'Beta C',
      createdAt: new Date('2026-09-20'),
    },
  ];

  it('newest first (numeric versions), up to the offered version', async () => {
    const { svc, finds } = make(docs);
    const all = await svc.releaseNotes('inverter', '1.1.10');
    expect(all.map((r) => r.version)).toEqual(['1.1.10', '1.1.6', '1.1.4']);
    expect(all[0].notes).toBe('Thêm B');
    // A stable user offered 1.1.4 does not see the newer (beta) builds.
    const stable = await svc.releaseNotes('inverter', '1.1.4');
    expect(stable.map((r) => r.version)).toEqual(['1.1.4']);
    expect(finds()).toBe(1); // cached
  });

  it('notes of one version', async () => {
    const { svc } = make(docs);
    expect(await svc.releaseNoteOf('inverter', '1.1.6')).toBe('Beta C');
    expect(await svc.releaseNoteOf('inverter', '1.1.5')).toBe('');
  });
});
