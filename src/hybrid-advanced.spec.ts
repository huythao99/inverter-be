/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
// Advanced settings menu of the hybrid ($GET,ADV / $SETADV, STM32 >= 5.4.12,
// PROTOCOL_HINVLF_V1 §13): body builder, password handling, stored state,
// HTTP endpoints, MQTT ACL, audit text.
import { NotFoundException } from '@nestjs/common';
import {
  HYBRID_ADV_KEYS,
  HYBRID_ADV_PW,
  HYBRID_COMMANDS,
  parseHybridAdvSet,
} from './constants/hybrid.constants';
import { HybridSettingService } from './services/hybrid-setting.service';
import { HybridDataService } from './services/hybrid-data.service';
import { UserHybridController } from './controllers/user-hybrid.controller';
import {
  MqttAuthService,
  isDeviceCmdTopic,
} from './services/mqtt-auth.service';
import { buildAuditSummary } from './services/audit-log.service';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** In-memory HybridData collection: enough of findOne / updateOne. */
function dataModel(initial: Record<string, any> = {}) {
  const doc: Record<string, any> = { ...initial };
  const q = () => ({
    select: () => q(),
    lean: () => q(),
    exec: () => Promise.resolve({ ...doc }),
  });
  return {
    doc,
    findOne: () => q(),
    updateOne: (_f: unknown, u: any) => {
      Object.assign(doc, u.$set ?? {});
      for (const k of Object.keys(u.$unset ?? {})) delete doc[k];
      return { exec: () => Promise.resolve({}) };
    },
  };
}

function fakeMqtt() {
  const sent: any[] = [];
  return {
    sent,
    emitHybridAdv: (u: string, d: string, p: any) => {
      sent.push({ u, d, ...p });
      return Promise.resolve();
    },
    emitHybridCommand: (u: string, d: string, cmd: string) => {
      sent.push({ u, d, cmd });
      return Promise.resolve();
    },
  };
}

function stack(owned = true, initial: Record<string, any> = {}) {
  const model = dataModel(initial);
  const mqtt = fakeMqtt();
  const events: any[] = [];
  const settings = new HybridSettingService(
    {} as any,
    mqtt as any,
    { emit: (_n: string, e: any) => events.push(e) } as any,
  );
  const data = new HybridDataService(model as any, {} as any);
  const devices = {
    findByUserIdAndDeviceId: () =>
      Promise.resolve(owned ? { deviceId: 'H1' } : null),
  };
  const ctrl = new UserHybridController(
    devices as any,
    settings,
    data,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mqtt as any,
  );
  const user = { uid: 'u1' } as any;
  const req = { headers: {}, ip: '1.2.3.4' } as any;
  /** A frame from the device (hybrid/u1/H1/data). */
  const frame = async (raw: string) => {
    data.onData({ userId: 'u1', deviceId: 'H1', data: { raw } });
    await new Promise((r) => setTimeout(r, 5));
  };
  return { model, mqtt, events, settings, data, ctrl, user, req, frame };
}

// ---------------------------------------------------------------------------

describe('parseHybridAdvSet ($SETADV body)', () => {
  it('formats numbers with the key decimals, no exponent', () => {
    expect(
      parseHybridAdvSet({ N: '9', CF: 30, LF: '1.55', VGMAX: '254.6' }).set,
    ).toBe('N=9.00,CF=30.0,LF=1.6,VGMAX=255');
    expect(parseHybridAdvSet({ CVB: 51.2, CII: '6.9' }).set).toBe(
      'CVB=51.20,CII=6.90',
    );
    expect(parseHybridAdvSet({ VCV: 0.0000001 }).set).toBe('VCV=0.0');
  });

  it('always sends SYS first (the STM32 reloads the battery limits from it)', () => {
    expect(parseHybridAdvSet({ VCV: 28.5, SYS: 24 }).set).toBe(
      'SYS=24,VCV=28.5',
    );
  });

  it('enums: case-insensitive, fixed list', () => {
    expect(parseHybridAdvSet({ hall: 'yes', fhz: 60 }).set).toBe(
      'FHZ=60,HALL=YES',
    );
    for (const bad of [
      { FHZ: 55 },
      { HALL: 'MAYBE' },
      { SYS: 48.5 },
      { HALL: {} },
    ]) {
      expect(parseHybridAdvSet(bad).errors).toHaveLength(1);
    }
  });

  it('refuses keys of the basic menu and read-only ones', () => {
    for (const k of [
      'VCUT',
      'VRES',
      'PMAX',
      'PCMAX',
      'MODE',
      'PW',
      'LFID',
      'KVO',
      'MVB',
    ]) {
      expect(parseHybridAdvSet({ [k]: 1 }).errors[0].key).toBe(k);
    }
  });

  it('refuses values that could break the frame or are not plain numbers', () => {
    for (const v of [
      '55,VOVP=99',
      '1e3',
      '-5',
      '',
      null,
      NaN,
      Infinity,
      '５５',
    ]) {
      expect(parseHybridAdvSet({ VCV: v }).errors).toHaveLength(1);
    }
  });

  it('FACT only alone, value 1', () => {
    expect(parseHybridAdvSet({ FACT: 1 })).toEqual({
      set: 'FACT=1',
      errors: [],
    });
    expect(parseHybridAdvSet({ FACT: 0 }).errors).toHaveLength(1);
    expect(parseHybridAdvSet({ FACT: 1, SYS: 48 }).errors[0].key).toBe('FACT');
  });

  it('every writable key of §13 is known, calibration ones flagged', () => {
    expect(Object.keys(HYBRID_ADV_KEYS).sort()).toEqual(
      [
        'CF',
        'CIG',
        'CII',
        'CVB',
        'CVG',
        'CVO',
        'FACT',
        'FHZ',
        'HALL',
        'LF',
        'N',
        'SYS',
        'VCV',
        'VGMAX',
        'VGMIN',
        'VOVP',
      ].sort(),
    );
    const cal = Object.entries(HYBRID_ADV_KEYS)
      .filter(([, d]) => d.cal)
      .map(([k]) => k);
    expect(cal.sort()).toEqual(['CIG', 'CII', 'CVB', 'CVG', 'CVO']);
  });

  it('password: letters / digits, 1-16 chars', () => {
    for (const ok of ['1', '123', 'Ab9', 'x'.repeat(16)]) {
      expect(HYBRID_ADV_PW.test(ok)).toBe(true);
    }
    for (const bad of [
      '',
      'x'.repeat(17),
      '12 3',
      '1,2',
      'a=b',
      'a*b',
      '$1',
      'mật',
    ]) {
      expect(HYBRID_ADV_PW.test(bad)).toBe(false);
    }
  });

  it('SAVE is an app command now, FWU still not', () => {
    expect(HYBRID_COMMANDS).toContain('SAVE');
    expect(HYBRID_COMMANDS as readonly string[]).not.toContain('FWU');
  });
});

describe('HybridSettingService.advRead / advSet', () => {
  it('advRead: watch clamped to 0..60 s, omitted when 0', async () => {
    const { settings, mqtt } = stack();
    await settings.advRead('u1', 'H1');
    await settings.advRead('u1', 'H1', 30);
    await settings.advRead('u1', 'H1', 999);
    await settings.advRead('u1', 'H1', 'x');
    expect(mqtt.sent).toEqual([
      { u: 'u1', d: 'H1', cmd: 'ADV' },
      { u: 'u1', d: 'H1', cmd: 'ADV', watch: 30 },
      { u: 'u1', d: 'H1', cmd: 'ADV', watch: 60 },
      { u: 'u1', d: 'H1', cmd: 'ADV' },
    ]);
  });

  it('a bad item: nothing sent, every error returned', async () => {
    const { settings, mqtt } = stack();
    await expect(
      settings.advSet('u1', 'H1', '123', { VCV: 'x', VCUT: 40 }),
    ).rejects.toMatchObject({
      response: { errors: [{ key: 'VCV' }, { key: 'VCUT' }] },
    });
    expect(mqtt.sent).toEqual([]);
  });

  it('items that are not an object are ignored (password check only)', async () => {
    const { settings, mqtt, events } = stack();
    for (const items of [null, 'VCV=55', ['VCV'], 42]) {
      await settings.advSet('u1', 'H1', '123', items);
    }
    expect(mqtt.sent.every((s) => s.cmd === 'SETADV' && s.set === '')).toBe(
      true,
    );
    expect(events).toEqual([]);
  });

  it('audit: items only, with the source of the change', async () => {
    const { settings, events } = stack();
    await settings.advSet('u1', 'H1', 'S3cret', { SYS: 24, VCV: 28.5 }, {
      source: 'app',
      actor: 'u1',
    } as any);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'hybrid',
      action: 'advanced',
      after: 'SYS=24,VCV=28.5',
      ctx: { source: 'app' },
    });
    expect(JSON.stringify(events)).not.toContain('S3cret');
  });
});

describe('HybridDataService: frames of the advanced menu', () => {
  it('a later $ADV replaces the readings; an older STM32 refusal is cleared by it', async () => {
    const { frame, model } = stack(true, { info: { FW: '5.4.10' } });
    await frame('$NAK,GET,ERR=UNSUP*4B');
    expect(model.doc.advUnsupportedFw).toBe('5.4.10');
    await frame('$ADV,MVB=51.20*00');
    await frame('$ADV,MVB=51.30*00');
    expect(model.doc.adv).toEqual({ MVB: '51.30' });
    expect(model.doc.advUnsupportedFw).toBeUndefined();
  });

  it('a NAK of SET / CMD still goes to lastNak (settings banner), not advResult', async () => {
    const { frame, model } = stack();
    await frame('$NAK,SET,ERR=LOCAL*C0');
    expect(model.doc.lastNak).toMatchObject({ of: 'SET', err: 'LOCAL' });
    expect(model.doc.advResult).toBeUndefined();
  });

  it('a TIMEOUT made by the ESP32 is a SETADV result too', async () => {
    const { frame, model } = stack();
    await frame('$NAK,SETADV,ERR=TIMEOUT*3C');
    expect(model.doc.advResult).toMatchObject({ ok: false, err: 'TIMEOUT' });
    expect(model.doc.lastNak).toBeUndefined();
  });

  it('a plain $ACK (SET / CMD) is not a SETADV result', async () => {
    const { frame, model } = stack();
    await frame('$ACK,SET*EE');
    await frame('$ACK,CMD,SAVE*5D');
    expect(model.doc.advResult).toBeUndefined();
  });

  it('advanced(): src / mode / ist for the "turn the machine off" step', async () => {
    const { data, frame } = stack();
    await frame('$TLM,DEV=HINVLF,ST=RUN,SRC=ESP,MODE=LOAD,IST=GRID*00');
    let r = await data.advanced('u1', 'H1');
    expect(r).toMatchObject({
      src: 'ESP',
      mode: 'LOAD',
      ist: 'GRID',
      supported: true,
      adv: null,
    });
    await frame('$CFG,MODE=OFF,SRC=ESP*00');
    await frame('$TLM,DEV=HINVLF,ST=OFF,SRC=ESP,MODE=OFF,IST=STANDBY*00');
    r = await data.advanced('u1', 'H1');
    expect(r).toMatchObject({ mode: 'OFF', ist: 'STANDBY' });
  });
});

describe('UserHybridController: /hybrids/:id/advanced', () => {
  it('not my device: 404, nothing sent', async () => {
    const { ctrl, user, req, mqtt } = stack(false);
    await expect(ctrl.advanced(user, 'H1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctrl.advancedRead(user, 'H1', 30)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      ctrl.advancedSet(user, 'H1', '123', { VCV: 55 }, req),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mqtt.sent).toEqual([]);
  });

  it('full flow: unlock -> change -> reply; a reply older than the request is not shown', async () => {
    const { ctrl, user, req, mqtt, frame } = stack();
    // An old result from a previous session.
    await frame('$NAK,SETADV,ERR=PW*2A');

    const r1 = await ctrl.advancedSet(user, 'H1', '123', undefined, req);
    expect(r1.set).toBe('');
    expect(mqtt.sent[0]).toEqual({
      u: 'u1',
      d: 'H1',
      cmd: 'SETADV',
      pw: '123',
      set: '',
    });
    // On its way: the old PW refusal must not show.
    expect((await ctrl.advanced(user, 'H1')).result).toBeNull();
    await frame('$ACK,SETADV*A5');
    expect((await ctrl.advanced(user, 'H1')).result).toMatchObject({
      ok: true,
    });

    const r2 = await ctrl.advancedSet(user, 'H1', '123', { VCV: '55' }, req);
    expect(r2.set).toBe('VCV=55.0');
    expect(new Date(r2.requestAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await ctrl.advanced(user, 'H1')).result).toBeNull();
    await frame('$NAK,SETADV,ERR=RUNNING*74');
    expect((await ctrl.advanced(user, 'H1')).result).toMatchObject({
      ok: false,
      err: 'RUNNING',
    });
  });

  it('a reply that lands before the request is stored still counts', async () => {
    const { ctrl, user, req, data, frame } = stack();
    // Device answers within the publish: the ACK is stored before
    // markAdvRequest runs. requestAt is taken before sending, so it counts.
    const orig = data.markAdvRequest.bind(data);
    data.markAdvRequest = async (u: string, d: string, at?: Date) => {
      await frame('$ACK,SETADV*A5');
      return orig(u, d, at);
    };
    await ctrl.advancedSet(user, 'H1', '123', { FHZ: 60 }, req);
    expect((await ctrl.advanced(user, 'H1')).result).toMatchObject({
      ok: true,
    });
  });

  it('invalid password or item: 400, request not marked, nothing sent', async () => {
    const { ctrl, user, req, mqtt, model } = stack();
    await expect(
      ctrl.advancedSet(user, 'H1', '1,2', {}, req),
    ).rejects.toThrow();
    await expect(
      ctrl.advancedSet(user, 'H1', undefined, {}, req),
    ).rejects.toThrow();
    await expect(
      ctrl.advancedSet(user, 'H1', '123', { PMAX: 1 }, req),
    ).rejects.toThrow();
    expect(mqtt.sent).toEqual([]);
    expect(model.doc.advRequestAt).toBeUndefined();
  });

  it('read: asks the device and returns the stored state', async () => {
    const { ctrl, user, mqtt, frame } = stack();
    await frame('$ADV,SYS=48,VCV=56.5*00');
    const r = await ctrl.advancedRead(user, 'H1', 20);
    expect(mqtt.sent).toEqual([{ u: 'u1', d: 'H1', cmd: 'ADV', watch: 20 }]);
    expect(r.adv).toEqual({ SYS: '48', VCV: '56.5' });
  });
});

describe('MQTT ACL: command topics (may carry the menu password)', () => {
  it.each([
    ['hybrid/u1/H1/cmd/action', true],
    ['hybrid/u1/H1/cmd/settings', true],
    ['charger/u1/C1/cmd/settings', true],
    ['inverter/u1/D1/cmd/grid-tie', true],
    ['hybrid/u1/H1/data', false],
    ['hybrid/u1/H1/raw', false],
    ['hybrid/u1/H1/#', false],
    ['devices/inverter/u1/D1', false],
  ])('isDeviceCmdTopic(%s) = %s', (topic, cmd) => {
    expect(isDeviceCmdTopic(topic)).toBe(cmd);
  });

  const svcFor = (kind: string) =>
    new MqttAuthService(
      {
        findOne: () => ({
          exec: () =>
            Promise.resolve({
              _id: 'c',
              userId: 'u1',
              kind,
              deviceId: 'H1',
              mqttUsername: `${kind}_x`,
              isActive: true,
            }),
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      } as any,
      { get: (_k: string, d?: unknown) => d } as any,
    );

  it('the device itself still receives its cmd/action', async () => {
    expect(
      await svcFor('hybrid').checkAcl(
        'hybrid_x',
        'hybrid/u1/H1/cmd/action',
        'subscribe',
      ),
    ).toBe(true);
    expect(
      await svcFor('hybrid').checkAcl(
        'hybrid_x',
        'hybrid/u1/H1/cmd/action',
        'read',
      ),
    ).toBe(true);
  });

  it.each(['app', 'cms'])(
    '%s: no subscribe, no per-message read of cmd/action',
    async (kind) => {
      const svc = svcFor(kind);
      expect(
        await svc.checkAcl(`${kind}_x`, 'hybrid/u1/H1/cmd/action', 'subscribe'),
      ).toBe(false);
      expect(
        await svc.checkAcl(`${kind}_x`, 'hybrid/u1/H1/cmd/action', 'read'),
      ).toBe(false);
      expect(await svc.checkAcl(`${kind}_x`, 'hybrid/u1/H1/data', 'read')).toBe(
        true,
      );
    },
  );
});

describe('audit summary of an advanced change', () => {
  const sum = (after: string) =>
    buildAuditSummary({
      kind: 'hybrid',
      action: 'advanced',
      before: null,
      after,
    });
  it('labels + units, factory reset, unknown keys kept as is', () => {
    expect(sum('SYS=24,VCV=28.5')).toBe(
      'Cài đặt nâng cao: Hệ pin 24 V; Áp sạc 28.5 V',
    );
    expect(sum('FACT=1')).toBe('Cài đặt nâng cao: Khôi phục cài đặt gốc');
    expect(sum('HALL=AUTO')).toBe('Cài đặt nâng cao: Hall sơ cấp AUTO');
    expect(sum('ZZZ=1')).toBe('Cài đặt nâng cao: ZZZ=1');
  });
  it('SAVE command has a label', () => {
    expect(
      buildAuditSummary({
        kind: 'hybrid',
        action: 'command',
        before: null,
        after: 'SAVE',
      }),
    ).toBe('Lưu cài đặt vào máy');
  });
});
