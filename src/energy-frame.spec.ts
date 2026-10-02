import { energyOfFrame } from './services/inverter-data.service';
import { isEnergyFrame, isShortFrame } from './services/mqtt.service';

describe('10-number energy frames', () => {
  it('takes the last two numbers as this frame energy (1e-6 kWh)', () => {
    const e = energyOfFrame('230#50#-120#51.2#940#41#46.5#1000#2500#800')!;
    expect(e.totalA).toBeCloseTo(0.0025, 9);
    expect(e.totalA2).toBeCloseTo(0.0008, 9);
    // trailing '#' is ignored
    expect(
      energyOfFrame('230#50#-120#51.2#940#41#46.5#1000#2500#800#'),
    ).toEqual(e);
  });

  it('adds every frame: 10 frames of 1 s = 10 x the energy', () => {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += energyOfFrame('1#2#3#4#5#6#7#8#100#0')!.totalA;
    }
    expect(sum).toBeCloseTo(0.001, 9);
  });

  it('ignores other layouts and implausible values', () => {
    expect(energyOfFrame('1#2#3#4#5#6#7#8')).toBeNull();
    expect(energyOfFrame('1#2#3#4#5#6#7#8#9#10#11#12')).toBeNull();
    expect(energyOfFrame('1#2#3#4#5#6#7#8#20000#0')).toBeNull();
    expect(energyOfFrame('1#2#3#4#5#6#7#8#x#0')).toBeNull();
  });

  it('negative values are added as they are', () => {
    const e = energyOfFrame(
      '238.61#50.02#8.11#40.55#314.42#41.00#37.50#1600.00#874.59#-7.88',
    )!;
    expect(e.totalA).toBeCloseTo(874.59 / 1e6, 12);
    expect(e.totalA2).toBeCloseTo(-7.88 / 1e6, 12);
    const both = energyOfFrame('1#2#3#4#5#6#7#8#-5#-1')!;
    expect(both.totalA).toBeCloseTo(-5 / 1e6, 12);
    expect(both.totalA2).toBeCloseTo(-1 / 1e6, 12);
    expect(energyOfFrame('1#2#3#4#5#6#7#8#-20000#0')).toBeNull();
    expect(energyOfFrame('1#2#3#4#5#6#7#8#0#0')).toBeNull();
  });

  it('is detected before the MQTT rate limit', () => {
    expect(isEnergyFrame('1#2#3#4#5#6#7#8#9#10')).toBe(true);
    expect(isEnergyFrame('1#2#3#4#5#6#7#8')).toBe(false);
    expect(isEnergyFrame('1#2#3#4#5#6#7#8#9#10#11#12')).toBe(false);
  });
});

describe('8-number frames', () => {
  it('are recognised from the MQTT payload', () => {
    expect(isShortFrame('{"value":"230#50#-120#51.2#940#41#46.5#1000"}')).toBe(
      true,
    );
    expect(isShortFrame('{"value":"1#2#3#4#5#6#7#8#9#10"}')).toBe(false);
    expect(isShortFrame('{"foo":1}')).toBe(false);
  });
});
