import { gridClustersOf } from './services/share.service';

describe('share groups = one grid line (energy overview)', () => {
  it('clusters devices of overlapping groups', () => {
    const c = gridClustersOf([
      { members: [{ deviceId: 'A' }, { deviceId: 'B' }] },
      { members: [{ deviceId: 'B' }, { deviceId: 'C' }] },
      { members: [{ deviceId: 'D' }, { deviceId: 'E' }] },
      { members: [{ deviceId: 'F' }] },
    ]);
    expect(c.get('A')).toBe(c.get('C'));
    expect(c.get('D')).toBe(c.get('E'));
    expect(c.get('A')).not.toBe(c.get('D'));
    expect(c.has('F')).toBe(false);
  });
});
