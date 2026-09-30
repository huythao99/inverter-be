/**
 * Home Assistant MQTT discovery: entity definitions, frame parsing and the
 * discovery/config messages. Pure functions (no Nest), unit-tested.
 *
 * Topics (one namespace per user, read-only for the user's `ha_` account):
 *   <prefix>/sensor/<deviceId>/<key>/config      discovery (retained)
 *   inverter_ha/<uid>/<deviceId>/state           JSON state (every 30 s)
 *   inverter_ha/<uid>/<deviceId>/availability    online | offline (retained)
 * where <prefix> = "gti_" + the account suffix (hassPrefixFor).
 */

export type HassKind = 'inverter' | 'charger';

export interface HassEntity {
  key: string; // JSON field in the state payload, part of unique_id
  name: string;
  unit?: string;
  deviceClass?: string;
  stateClass?: 'measurement' | 'total_increasing';
  icon?: string;
  diagnostic?: boolean;
  precision?: number;
}

export const INVERTER_ENTITIES: HassEntity[] = [
  {
    key: 'grid_tie_power',
    name: 'Công suất hoà lưới',
    unit: 'W',
    deviceClass: 'power',
    stateClass: 'measurement',
    precision: 0,
  },
  {
    key: 'grid_power',
    name: 'Công suất lấy lưới',
    unit: 'W',
    deviceClass: 'power',
    stateClass: 'measurement',
    precision: 0,
  },
  {
    key: 'load_power',
    name: 'Công suất tiêu thụ',
    unit: 'W',
    deviceClass: 'power',
    stateClass: 'measurement',
    precision: 0,
  },
  {
    key: 'battery_power',
    name: 'Công suất xả ắc quy',
    unit: 'W',
    deviceClass: 'power',
    stateClass: 'measurement',
    precision: 0,
  },
  {
    key: 'grid_voltage',
    name: 'Điện áp lưới',
    unit: 'V',
    deviceClass: 'voltage',
    stateClass: 'measurement',
    precision: 1,
  },
  {
    key: 'grid_frequency',
    name: 'Tần số lưới',
    unit: 'Hz',
    deviceClass: 'frequency',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'battery_voltage',
    name: 'Điện áp ắc quy',
    unit: 'V',
    deviceClass: 'voltage',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'battery_current',
    name: 'Dòng xả ắc quy',
    unit: 'A',
    deviceClass: 'current',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'mosfet_temperature',
    name: 'Nhiệt độ MOSFET',
    unit: '°C',
    deviceClass: 'temperature',
    stateClass: 'measurement',
    precision: 1,
  },
  {
    key: 'energy_today',
    name: 'Năng lượng xả hôm nay',
    unit: 'kWh',
    deviceClass: 'energy',
    stateClass: 'total_increasing',
    precision: 2,
  },
  {
    key: 'grid_energy_today',
    name: 'Lấy lưới hôm nay',
    unit: 'kWh',
    deviceClass: 'energy',
    stateClass: 'total_increasing',
    precision: 2,
  },
  {
    key: 'cutoff_voltage',
    name: 'Ngưỡng điện áp ngắt',
    unit: 'V',
    deviceClass: 'voltage',
    diagnostic: true,
    precision: 2,
  },
  {
    key: 'power_limit',
    name: 'Giới hạn công suất',
    unit: 'W',
    deviceClass: 'power',
    diagnostic: true,
    precision: 0,
  },
];

export const CHARGER_ENTITIES: HassEntity[] = [
  {
    key: 'pv_power',
    name: 'Công suất tấm pin',
    unit: 'W',
    deviceClass: 'power',
    stateClass: 'measurement',
    precision: 0,
  },
  {
    key: 'pv_voltage',
    name: 'Điện áp tấm pin',
    unit: 'V',
    deviceClass: 'voltage',
    stateClass: 'measurement',
    precision: 1,
  },
  {
    key: 'pv_current',
    name: 'Dòng tấm pin',
    unit: 'A',
    deviceClass: 'current',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'battery_voltage',
    name: 'Điện áp ắc quy',
    unit: 'V',
    deviceClass: 'voltage',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'battery_current',
    name: 'Dòng sạc ắc quy',
    unit: 'A',
    deviceClass: 'current',
    stateClass: 'measurement',
    precision: 2,
  },
  {
    key: 'temperature',
    name: 'Nhiệt độ',
    unit: '°C',
    deviceClass: 'temperature',
    stateClass: 'measurement',
    precision: 1,
  },
  {
    key: 'fault',
    name: 'Mã lỗi',
    icon: 'mdi:alert-circle-outline',
    diagnostic: true,
  },
];

export const HASS_STATE_ROOT = 'inverter_ha';

/** Kill switch: HASS_ENABLED=false in .env turns the whole feature off. */
export function hassEnabled(): boolean {
  return (process.env.HASS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** Discovery prefix of an `ha_` account: unique because usernames are. */
export function hassPrefixFor(mqttUsername: string): string {
  return `gti_${mqttUsername.replace(/^ha_/, '')}`;
}

export const stateTopic = (uid: string, deviceId: string) =>
  `${HASS_STATE_ROOT}/${uid}/${deviceId}/state`;
export const availabilityTopic = (uid: string, deviceId: string) =>
  `${HASS_STATE_ROOT}/${uid}/${deviceId}/availability`;

const num = (v: unknown): number | null => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const round = (v: number | null, d: number): number | null =>
  v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

/**
 * Inverter frame "vAC#fHz#pGrid#vBat#pGridTie#temp#cutoff#limit[#...]"
 * (same meaning as the app/web). Null when it isn't a frame.
 */
export function inverterState(
  value: string,
): Record<string, number | null> | null {
  if (!value || typeof value !== 'string') return null;
  const p = value.replace(/\$/g, '').split('#');
  if (p.length < 8) return null;
  const gridVoltage = num(p[0]);
  const gridPower = num(p[2]);
  const batteryVoltage = num(p[3]);
  const gridTie = num(p[4]);
  if (gridVoltage === null || gridTie === null) return null;
  const batteryPower = gridTie / 0.94;
  return {
    grid_voltage: round(gridVoltage, 1),
    grid_frequency: round(num(p[1]), 2),
    grid_power: round(gridPower, 0),
    battery_voltage: round(batteryVoltage, 2),
    grid_tie_power: round(gridTie, 0),
    mosfet_temperature: round(num(p[5]), 1),
    cutoff_voltage: round(num(p[6]), 2),
    power_limit: round(num(p[7]), 0),
    battery_power: round(batteryPower, 0),
    load_power: gridPower === null ? null : round(gridPower + gridTie, 0),
    battery_current:
      batteryVoltage && batteryVoltage > 0
        ? round(batteryPower / batteryVoltage, 2)
        : null,
  };
}

/** Charger TLM frame (parsed key/values: VPV, IPV, PPV, VBAT, IBAT, T, FLT). */
export function chargerState(
  kv: Record<string, string>,
): Record<string, number | string | null> | null {
  if (!kv || String(kv.type).toUpperCase() !== 'TLM') return null;
  return {
    pv_voltage: round(num(kv.VPV), 1),
    pv_current: round(num(kv.IPV), 2),
    pv_power: round(num(kv.PPV), 0),
    battery_voltage: round(num(kv.VBAT), 2),
    battery_current: round(num(kv.IBAT), 2),
    temperature: round(num(kv.T), 1),
    fault: kv.FLT ?? null,
  };
}

export interface HassDevice {
  kind: HassKind;
  deviceId: string;
  name: string;
  firmware?: string;
}

export function entitiesFor(kind: HassKind): HassEntity[] {
  return kind === 'inverter' ? INVERTER_ENTITIES : CHARGER_ENTITIES;
}

/** Retained discovery messages for one device of one user. */
export function discoveryMessages(
  uid: string,
  prefix: string,
  d: HassDevice,
): Array<{ topic: string; payload: Record<string, unknown> }> {
  const safeId = d.deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const device = {
    identifiers: [`gti_${safeId}`],
    name: d.name || d.deviceId,
    manufacturer: 'Gia Bảo',
    model:
      d.kind === 'inverter'
        ? 'GTI Control (hoà lưới)'
        : 'Charger Control (MPPT)',
    serial_number: d.deviceId,
    ...(d.firmware ? { sw_version: d.firmware } : {}),
  };
  return entitiesFor(d.kind).map((e) => ({
    topic: `${prefix}/sensor/${safeId}/${e.key}/config`,
    payload: {
      name: e.name,
      has_entity_name: true,
      unique_id: `gti_${safeId}_${e.key}`,
      state_topic: stateTopic(uid, d.deviceId),
      value_template: `{{ value_json.${e.key} }}`,
      availability_topic: availabilityTopic(uid, d.deviceId),
      ...(e.unit ? { unit_of_measurement: e.unit } : {}),
      ...(e.deviceClass ? { device_class: e.deviceClass } : {}),
      ...(e.stateClass ? { state_class: e.stateClass } : {}),
      ...(e.icon ? { icon: e.icon } : {}),
      ...(e.diagnostic ? { entity_category: 'diagnostic' } : {}),
      ...(e.precision !== undefined
        ? { suggested_display_precision: e.precision }
        : {}),
      device,
      origin: { name: 'Gia Bảo Inverter' },
    },
  }));
}

/** Topics to clear (empty retained) when a device is removed. */
export function discoveryTopics(prefix: string, d: HassDevice): string[] {
  const safeId = d.deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return entitiesFor(d.kind).map(
    (e) => `${prefix}/sensor/${safeId}/${e.key}/config`,
  );
}

/** Mosquitto bridge config for users who already run a local broker. */
export function bridgeConfig(o: {
  host: string;
  port: number;
  username: string;
  password: string;
  prefix: string;
  uid: string;
}): string {
  return [
    '# Home Assistant -> Gia Bảo Inverter (chỉ nhận dữ liệu)',
    'connection giabao_inverter',
    `address ${o.host}:${o.port}`,
    'bridge_protocol_version mqttv311',
    'bridge_cafile /etc/ssl/certs/ca-certificates.crt',
    'bridge_insecure false',
    `remote_clientid ${o.username}_bridge`,
    `remote_username ${o.username}`,
    `remote_password ${o.password}`,
    'cleansession true',
    'try_private false',
    'start_type automatic',
    '# discovery: remote gti_... -> local homeassistant/... (prefix mặc định)',
    `topic # in 0 homeassistant/ ${o.prefix}/`,
    `topic # in 0 ${HASS_STATE_ROOT}/${o.uid}/ ${HASS_STATE_ROOT}/${o.uid}/`,
    '',
  ].join('\n');
}
