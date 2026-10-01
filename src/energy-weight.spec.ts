import {
  ENERGY_FRAME_MS,
  energyFrameWeight,
} from './services/inverter-data.service';
import { isShortFrame } from './services/mqtt.service';

describe('10-number energy frame weight', () => {
  it('counts a normal 3 s frame once', () => {
    expect(energyFrameWeight(undefined, 1000)).toBe(1);
    expect(energyFrameWeight(0, ENERGY_FRAME_MS)).toBe(1);
  });

  it('makes up for a frame dropped by the rate limit', () => {
    const w = energyFrameWeight(0, 4000) + energyFrameWeight(4000, 6000);
    expect(w).toBeCloseTo(6000 / ENERGY_FRAME_MS, 6);
  });

  it('keeps the total right over a minute whatever the cadence', () => {
    for (const step of [1000, 2600, 3000, 3400, 4000, 5000]) {
      let t = 0;
      let sum = 0;
      let prev: number | undefined = 0;
      while (t + step <= 60000) {
        t += step;
        sum += energyFrameWeight(prev, t);
        prev = t;
      }
      expect(sum * ENERGY_FRAME_MS).toBeCloseTo(t, 6);
    }
  });

  it('never extrapolates over an outage', () => {
    expect(energyFrameWeight(0, 10 * 60_000)).toBe(1);
    expect(energyFrameWeight(5000, 5000)).toBe(1);
  });
});

describe('8-number frames', () => {
  it('are recognised from the MQTT payload', () => {
    expect(isShortFrame('{"value":"230#50#-120#51.2#940#41#46.5#1000"}')).toBe(
      true,
    );
    expect(
      isShortFrame(
        '{"value":"230#50#-120#51.2#940#41#46.5#1000#12#3","totalACapacity":"1"}',
      ),
    ).toBe(false);
    expect(isShortFrame('{"value":"1#2#3#4#5#6#7#8#9#10#11#12"}')).toBe(false);
    expect(isShortFrame('{"foo":1}')).toBe(false);
  });
});
