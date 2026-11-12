// Collection names are fixed explicitly (they used to come from Mongoose's
// pluralized model names). Renaming one would silently start an empty
// collection in production: this test pins them.
import { Schema } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { InverterDeviceSchema } from './inverter-device.schema';
import { HybridDeviceSchema } from './hybrid-device.schema';
import { ChargerDeviceSchema } from './charger-device.schema';

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

describe('device schemas (shared base)', () => {
  it('inverter: base + STM32 + own fields, no conversion field', () => {
    expect(
      has(InverterDeviceSchema, [
        ...BASE,
        ...STM,
        'autoCalculate',
        'stmProtocol',
      ]),
    ).toEqual([]);
    expect(InverterDeviceSchema.path('hybridConversion')).toBeUndefined();
    expect(InverterDeviceSchema.get('collection')).toBe('inverterdevices');
  });
  it('hybrid: base + STM32, no conversion fields', () => {
    expect(has(HybridDeviceSchema, [...BASE, ...STM])).toEqual([]);
    expect(HybridDeviceSchema.path('convertedFrom')).toBeUndefined();
    expect(HybridDeviceSchema.path('inverterConversion')).toBeUndefined();
    expect(HybridDeviceSchema.get('collection')).toBe('hybriddevices');
  });
  it('charger: base only', () => {
    expect(has(ChargerDeviceSchema, BASE)).toEqual([]);
    expect(ChargerDeviceSchema.path('stmOta')).toBeUndefined();
    expect(ChargerDeviceSchema.get('collection')).toBe('chargerdevices');
  });
  it('defaults and required flags kept', () => {
    expect(InverterDeviceSchema.path('firmwareVersion').options.default).toBe(
      '1.0.0',
    );
    expect(HybridDeviceSchema.path('userId').isRequired).toBe(true);
    expect(InverterDeviceSchema.path('stmProtocol').options.default).toBe(
      'auto',
    );
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
    'charger-device.schema.ts': ['chargerdevices'],
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
    'hybrid-device.schema.ts': ['hybriddevices'],
    'hybrid-energy.schema.ts': ['hybridenergies'],
    'hybrid-setting.schema.ts': ['hybridsettings'],
    'inverter-data.schema.ts': ['inverterdatas'],
    'inverter-device.schema.ts': ['inverterdevices'],
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
