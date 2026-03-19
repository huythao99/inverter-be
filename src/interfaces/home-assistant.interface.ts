/**
 * Home Assistant MQTT Discovery Interfaces
 * These interfaces define the structure for Home Assistant auto-discovery via MQTT
 */

/**
 * Device information for Home Assistant device registry
 */
export interface HADeviceInfo {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  sw_version?: string;
  via_device?: string;
}

/**
 * Base discovery payload structure
 */
export interface HADiscoveryPayloadBase {
  name: string;
  unique_id: string;
  device: HADeviceInfo;
  availability_topic: string;
  payload_available?: string;
  payload_not_available?: string;
}

/**
 * Sensor discovery payload (read-only entities)
 */
export interface HASensorDiscoveryPayload extends HADiscoveryPayloadBase {
  state_topic: string;
  value_template: string;
  device_class?: string;
  state_class?: string;
  unit_of_measurement?: string;
  icon?: string;
  entity_category?: 'config' | 'diagnostic';
}

/**
 * Number discovery payload (bidirectional numeric entities)
 */
export interface HANumberDiscoveryPayload extends HADiscoveryPayloadBase {
  state_topic: string;
  command_topic: string;
  value_template: string;
  min: number;
  max: number;
  step?: number;
  unit_of_measurement?: string;
  mode?: 'auto' | 'slider' | 'box';
  icon?: string;
}

/**
 * Switch discovery payload (bidirectional on/off entities)
 */
export interface HASwitchDiscoveryPayload extends HADiscoveryPayloadBase {
  state_topic: string;
  command_topic: string;
  value_template: string;
  payload_on: string;
  payload_off: string;
  state_on?: string;
  state_off?: string;
  icon?: string;
}

/**
 * Select discovery payload (bidirectional dropdown entities)
 */
export interface HASelectDiscoveryPayload extends HADiscoveryPayloadBase {
  state_topic: string;
  command_topic: string;
  value_template: string;
  options: string[];
  icon?: string;
}

/**
 * Union type for all discovery payloads
 */
export type HADiscoveryPayload =
  | HASensorDiscoveryPayload
  | HANumberDiscoveryPayload
  | HASwitchDiscoveryPayload
  | HASelectDiscoveryPayload;

/**
 * Device state payload published to Home Assistant
 */
export interface HADeviceState {
  totalA: number;
  totalA2: number;
  dailyTotalA: number;
  dailyTotalA2: number;
  totalACapacity: number;
  totalA2Capacity: number;
  firmwareVersion: string;
  deviceName: string;
  scheduleEnabled: 'ON' | 'OFF';
  operatingMode: string;
  updatedAt: string;
}

/**
 * Bridge state payload for overall system status
 */
export interface HABridgeState {
  state: 'online' | 'offline';
  version: string;
  devices_count: number;
  uptime: number;
  last_update: string;
}

/**
 * Command received from Home Assistant
 */
export interface HACommand {
  userId: string;
  deviceId: string;
  entity: string;
  value: string | number | boolean;
}

/**
 * Entity definition for creating discovery payloads
 */
export interface HAEntityDefinition {
  type: 'sensor' | 'number' | 'switch' | 'select';
  id: string;
  name: string;
  valueTemplate: string;
  deviceClass?: string;
  stateClass?: string;
  unit?: string;
  icon?: string;
  entityCategory?: 'config' | 'diagnostic';
  // Number-specific
  min?: number;
  max?: number;
  step?: number;
  mode?: 'auto' | 'slider' | 'box';
  // Switch-specific
  payloadOn?: string;
  payloadOff?: string;
  // Select-specific
  options?: string[];
}

/**
 * Inverter device with all related data for HA state publishing
 */
export interface InverterDeviceData {
  userId: string;
  deviceId: string;
  deviceName: string;
  firmwareVersion: string;
  value?: string;
  totalACapacity: number;
  totalA2Capacity: number;
  dailyTotalA: number;
  dailyTotalA2: number;
  scheduleEnabled: boolean;
  operatingMode: string;
  setting?: string;
  schedule?: string;
  updatedAt: Date;
}
