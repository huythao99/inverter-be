/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import {
  bridgeConfig,
  chargerState,
  discoveryMessages,
  discoveryTopics,
  hassPrefixFor,
  inverterState,
} from './hass/hass-discovery';
import { MqttAuthService } from './services/mqtt-auth.service';
import { HassBridgeService } from './hass/hass-bridge.service';

const chain = (v: unknown) => ({
  exec: () => Promise.resolve(v),
  select: () => chain(v),
  lean: () => chain(v),
});

describe('HASS discovery', () => {
  it('prefix comes from the ha_ username', () => {
    expect(hassPrefixFor('ha_AbCd1234')).toBe('gti_AbCd1234');
    expect(hassPrefixFor('ha_AbCd1234_9f0e')).toBe('gti_AbCd1234_9f0e');
  });

  it('builds one retained config per entity, per device', () => {
    const inv = discoveryMessages('uid1', 'gti_x', {
      kind: 'inverter',
      deviceId: 'GTI 862',
      name: 'Nhà',
      firmware: '1.2.3',
    });
    expect(inv.length).toBeGreaterThan(8);
    const p = inv.find(
      (m) => m.payload.unique_id === 'gti_GTI_862_grid_tie_power',
    )!;
    expect(p.topic).toBe('gti_x/sensor/GTI_862/grid_tie_power/config');
    expect(p.payload.state_topic).toBe('inverter_ha/uid1/GTI 862/state');
    expect(p.payload.availability_topic).toBe(
      'inverter_ha/uid1/GTI 862/availability',
    );
    expect((p.payload.device as any).sw_version).toBe('1.2.3');
    const energy = inv.find((m) => m.topic.includes('/energy_today/'))!;
    expect(energy.payload.device_class).toBe('energy');
    expect(energy.payload.state_class).toBe('total_increasing');
    const chg = discoveryMessages('uid1', 'gti_x', {
      kind: 'charger',
      deviceId: 'C1',
      name: '',
    });
    expect(chg.map((m) => m.topic)).toEqual(
      discoveryTopics('gti_x', { kind: 'charger', deviceId: 'C1', name: '' }),
    );
  });

  it('parses an inverter frame', () => {
    const s = inverterState('230.5#50.01#-120#51.2#940#41.3#46.5#1000')!;
    expect(s.grid_voltage).toBe(230.5);
    expect(s.grid_tie_power).toBe(940);
    expect(s.battery_power).toBe(1000);
    expect(s.load_power).toBe(820);
    expect(s.battery_current).toBeCloseTo(19.53, 2);
    expect(inverterState('garbage')).toBeNull();
  });

  it('parses a charger TLM frame only', () => {
    const s = chargerState({ type: 'TLM', VPV: '80.2', PPV: '512', FLT: '0' })!;
    expect(s.pv_voltage).toBe(80.2);
    expect(s.pv_power).toBe(512);
    expect(s.fault).toBe('0');
    expect(chargerState({ type: 'STS' })).toBeNull();
  });

  it('bridge config maps the remote prefix to homeassistant/', () => {
    const c = bridgeConfig({
      host: 'h',
      port: 8883,
      username: 'ha_x',
      password: 'p',
      prefix: 'gti_x',
      uid: 'u1',
    });
    expect(c).toContain('address h:8883');
    expect(c).toContain('topic # in 0 homeassistant/ gti_x/');
    expect(c).toContain('topic # in 0 inverter_ha/u1/ inverter_ha/u1/');
    expect(c).not.toMatch(/\bout\b|\bboth\b/);
  });
});

describe('HASS ACL (kind ha)', () => {
  const cred = {
    _id: 'c1',
    userId: 'u1',
    kind: 'ha',
    mqttUsername: 'ha_u1',
    isActive: true,
  };
  const updates: unknown[] = [];
  const model = {
    findOne: () => chain(cred),
    updateOne: (...a: unknown[]) => {
      updates.push(a);
      return chain({});
    },
  };
  const config = { get: (_k: string, d?: unknown) => d } as any;
  const svc = new MqttAuthService(model as any, config);

  it.each([
    ['gti_u1/#', 'subscribe', true],
    ['gti_u1/sensor/D1/x/config', 'read', true],
    ['inverter_ha/u1/#', 'subscribe', true],
    ['inverter_ha/u1/D1/state', 'read', true],
    ['inverter_ha/u1/D1/set/x', 'write', false],
    ['gti_u1/status', 'write', false],
    ['inverter_ha/+/D1/state', 'subscribe', false],
    ['inverter_ha/#', 'subscribe', false],
    ['homeassistant/#', 'subscribe', false],
    ['gti_u10/#', 'subscribe', false],
    ['inverter/u1/D1/data', 'read', false],
  ])('%s %s -> %s', async (topic, acc, ok) => {
    expect(await svc.checkAcl('ha_u1', topic, acc as any)).toBe(ok);
  });

  it('marks the account as seen at most once a minute', () => {
    expect(updates.length).toBe(1);
  });

  it('reads nothing when HASS_ENABLED=false', async () => {
    process.env.HASS_ENABLED = 'false';
    try {
      expect(await svc.checkAcl('ha_u1', 'gti_u1/#', 'subscribe')).toBe(false);
    } finally {
      delete process.env.HASS_ENABLED;
    }
    expect(await svc.checkAcl('ha_u1', 'gti_u1/#', 'subscribe')).toBe(true);
  });
});

describe('HASS bridge flush', () => {
  const sent: Array<[string, unknown, boolean]> = [];
  const mqtt = {
    publishWithRetain: (t: string, p: unknown, r: boolean) => {
      sent.push([t, p, r]);
      return Promise.resolve();
    },
  };
  const daily = {
    getDailyTotalsByDay: () =>
      Promise.resolve([
        { totalA: 1.234, totalA2: 0.5 },
        { totalA: 2, totalA2: 0.25 },
      ]),
  };
  const creds = [{ userId: 'u1', mqttUsername: 'ha_u1' }];
  const credModel = { find: () => chain(creds) };
  const devModel = {
    find: () => chain([{ deviceId: 'D1', deviceName: 'Nhà' }]),
  };
  const chgModel = { find: () => chain([]) };
  const svc = new HassBridgeService(
    credModel as any,
    devModel as any,
    chgModel as any,
    mqtt as any,
    daily as any,
  );

  it('publishes discovery, then one state with today energy', async () => {
    await svc.refreshActive();
    const retained = sent.filter((s) => s[2]);
    expect(retained.some((s) => s[0].startsWith('gti_u1/sensor/D1/'))).toBe(
      true,
    );
    expect(sent).toContainEqual([
      'inverter_ha/u1/D1/availability',
      'offline',
      true,
    ]);
    sent.length = 0;
    svc.onInverterData({
      currentUid: 'u1',
      wifiSsid: 'D1',
      data: { value: '230#50#100#51.2#940#40#46#1000' },
    });
    svc.onInverterData({
      currentUid: 'other',
      wifiSsid: 'X',
      data: { value: '1' },
    });
    expect(sent).toEqual([['inverter_ha/u1/D1/availability', 'online', true]]);
    await svc.flush();
    const state = sent.find((s) => s[0] === 'inverter_ha/u1/D1/state')!;
    expect(state[2]).toBe(false);
    expect((state[1] as any).grid_tie_power).toBe(940);
    expect((state[1] as any).energy_today).toBe(3.23);
    expect((state[1] as any).grid_energy_today).toBe(0.75);
    sent.length = 0;
    await svc.flush();
    expect(sent).toEqual([]);
  });
});

describe('HASS bridge clearUser', () => {
  it('empties retained discovery + availability of every device', async () => {
    const sent: Array<[string, unknown, boolean]> = [];
    const mqtt = {
      publishWithRetain: (t: string, p: unknown, r: boolean) => {
        sent.push([t, p, r]);
        return Promise.resolve();
      },
    };
    const svc = new HassBridgeService(
      { find: () => chain([]) } as any,
      { find: () => chain([{ deviceId: 'D1', deviceName: 'x' }]) } as any,
      { find: () => chain([{ deviceId: 'C1', deviceName: 'y' }]) } as any,
      mqtt as any,
      {} as any,
    );
    await svc.clearUser('u1', 'ha_u1');
    expect(sent.every(([, p, r]) => p === '' && r)).toBe(true);
    expect(sent.map((x) => x[0])).toEqual(
      expect.arrayContaining([
        'gti_u1/sensor/D1/grid_tie_power/config',
        'gti_u1/sensor/C1/pv_power/config',
        'inverter_ha/u1/D1/availability',
        'inverter_ha/u1/C1/availability',
      ]),
    );
  });
});
