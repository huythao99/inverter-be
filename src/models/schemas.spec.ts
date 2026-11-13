// Collection names are fixed explicitly (device kinds: discriminators of
// Device in "devices", no collection of their own) (they used to come from Mongoose's
// pluralized model names). Renaming one would silently start an empty
// collection in production: this test pins them.
import { Mongoose, Schema } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { Device, DeviceSchema } from './device.schema';
import { InverterDevice, InverterDeviceSchema } from './inverter-device.schema';
import { HybridDevice, HybridDeviceSchema } from './hybrid-device.schema';
import { ChargerDevice, ChargerDeviceSchema } from './charger-device.schema';

const BASE = [
  'userId',
  'deviceId',
  'deviceName',
  'firmwareVersion',
  'description',
  'updatedAt',
];
const STM = ['stmFwVersion', 'stmFwCrc', 'stmInfoAt', 'stmOta'];
const has = (s: Schema, keys: string[]) => keys.filter((k) => !s.path(k));
// Mongoose sets it on a discriminator's schema; not in its typings.
const mapping = (m: { schema: unknown }) =>
  (m.schema as { discriminatorMapping?: unknown }).discriminatorMapping;

describe('devices: one collection, kind = discriminator', () => {
  // Same registration as DevicesModule, on a private Mongoose instance.
  const mg = new Mongoose();
  const Base = mg.model(Device.name, DeviceSchema);
  const I = Base.discriminator(
    InverterDevice.name,
    InverterDeviceSchema,
    'inverter',
  );
  const C = Base.discriminator(
    ChargerDevice.name,
    ChargerDeviceSchema,
    'charger',
  );
  const H = Base.discriminator(HybridDevice.name, HybridDeviceSchema, 'hybrid');

  it('all kinds live in "devices", told apart by kind', () => {
    for (const m of [Base, I, C, H])
      expect(m.collection.collectionName).toBe('devices');
    expect(Base.schema.get('discriminatorKey')).toBe('kind');
    expect(mapping(I)).toMatchObject({
      key: 'kind',
      value: 'inverter',
    });
    expect(mapping(C)).toMatchObject({
      key: 'kind',
      value: 'charger',
    });
    expect(mapping(H)).toMatchObject({
      key: 'kind',
      value: 'hybrid',
    });
    expect(new I({}).get('kind')).toBe('inverter');
    expect(new H({}).get('kind')).toBe('hybrid');
  });
  it('inverter: base + STM32 + own fields, no conversion field', () => {
    expect(
      has(I.schema, [...BASE, ...STM, 'autoCalculate', 'stmProtocol']),
    ).toEqual([]);
    expect(I.schema.path('hybridConversion')).toBeUndefined();
    expect(I.schema.path('stmProtocol').options.default).toBe('auto');
  });
  it('hybrid: base + STM32, no conversion fields', () => {
    expect(has(H.schema, [...BASE, ...STM])).toEqual([]);
    expect(H.schema.path('convertedFrom')).toBeUndefined();
    expect(H.schema.path('inverterConversion')).toBeUndefined();
  });
  it('charger: base only', () => {
    expect(has(C.schema, BASE)).toEqual([]);
    expect(C.schema.path('stmOta')).toBeUndefined();
  });
  it('defaults, required, indexes', () => {
    expect(I.schema.path('firmwareVersion').options.default).toBe('1.0.0');
    expect(H.schema.path('userId').isRequired).toBe(true);
    const idx = DeviceSchema.indexes().map(
      ([k, o]) => JSON.stringify(k) + (o?.unique ? 'U' : ''),
    );
    expect(idx).toEqual(['{"userId":1,"deviceId":1}U', '{"deviceId":1}']);
  });
});

describe('collection names', () => {
  const expected: Record<string, string[]> = {
    'admin.schema.ts': ['admins'],
    'audit-log.schema.ts': ['audit_logs'],
    'beta-firmware-device.schema.ts': ['betafirmwaredevices'],
    'blacklist-device.schema.ts': ['blacklistdevices'],
    'charger-claim.schema.ts': ['chargerclaims'],
    'charger-data.schema.ts': ['chargerdatas'],
    'charger-device.schema.ts': [],
    'charger-setting.schema.ts': ['chargersettings'],
    'daily-totals.schema.ts': ['dailytotals'],
    'device-health.schema.ts': ['device_health'],
    'device-viewer.schema.ts': ['device_viewers', 'device_share_links'],
    'esp-firmware.schema.ts': ['esp_firmwares'],
    'firmware-rollout.schema.ts': [
      'firmware_rollouts',
      'firmware_rollout_devices',
    ],
    'hybrid-data.schema.ts': ['hybriddatas'],
    'hybrid-device.schema.ts': [],
    'hybrid-energy.schema.ts': ['hybridenergies'],
    'hybrid-setting.schema.ts': ['hybridsettings'],
    'inverter-data.schema.ts': ['inverterdatas'],
    'inverter-device.schema.ts': [],
    'device.schema.ts': ['devices'],
    'inverter-schedule.schema.ts': ['inverterschedules'],
    'inverter-setting.schema.ts': ['invertersettings'],
    'mqtt-credential.schema.ts': ['mqttcredentials'],
    'share-group.schema.ts': ['sharegroups'],
    'spaces-pending-delete.schema.ts': ['spaces_pending_deletes'],
    'stm-firmware.schema.ts': ['stm_firmwares'],
    'track-log-error.schema.ts': ['tracklogerrors'],
  };
  it.each(Object.entries(expected))('%s', (file, names) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const found = [...src.matchAll(/collection:\s*'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(found).toEqual(names);
  });
});
