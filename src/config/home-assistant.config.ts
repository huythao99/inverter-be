import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HAEntityDefinition } from '../interfaces/home-assistant.interface';

@Injectable()
export class HomeAssistantConfig {
  constructor(private configService: ConfigService) {}

  /**
   * Whether Home Assistant discovery is enabled
   */
  get isEnabled(): boolean {
    return (
      this.configService.get<string>('HA_DISCOVERY_ENABLED', 'true') === 'true'
    );
  }

  /**
   * MQTT discovery prefix (default: homeassistant)
   */
  get discoveryPrefix(): string {
    return this.configService.get<string>(
      'HA_DISCOVERY_PREFIX',
      'homeassistant',
    );
  }

  /**
   * State topic prefix (default: inverter_ha)
   */
  get statePrefix(): string {
    return this.configService.get<string>('HA_STATE_PREFIX', 'inverter_ha');
  }

  /**
   * Interval for publishing state updates in milliseconds
   */
  get statePublishInterval(): number {
    return this.configService.get<number>('HA_STATE_PUBLISH_INTERVAL', 30000);
  }

  /**
   * Device manufacturer name
   */
  get manufacturer(): string {
    return this.configService.get<string>('HA_MANUFACTURER', 'GiaBao Inverter');
  }

  /**
   * Device model name
   */
  get model(): string {
    return this.configService.get<string>('HA_MODEL', 'Smart Inverter');
  }

  /**
   * Bridge device ID
   */
  get bridgeDeviceId(): string {
    return this.configService.get<string>('HA_BRIDGE_ID', 'inverter_bridge');
  }

  /**
   * Get availability topic for a device
   */
  getAvailabilityTopic(userId: string, deviceId: string): string {
    return `${this.statePrefix}/${userId}/${deviceId}/availability`;
  }

  /**
   * Get state topic for a device
   */
  getStateTopic(userId: string, deviceId: string): string {
    return `${this.statePrefix}/${userId}/${deviceId}/state`;
  }

  /**
   * Get command topic for a device entity
   */
  getCommandTopic(userId: string, deviceId: string, entity: string): string {
    return `${this.statePrefix}/${userId}/${deviceId}/set/${entity}`;
  }

  /**
   * Get bridge availability topic
   */
  getBridgeAvailabilityTopic(): string {
    return `${this.statePrefix}/bridge/availability`;
  }

  /**
   * Get bridge state topic
   */
  getBridgeStateTopic(): string {
    return `${this.statePrefix}/bridge/state`;
  }

  /**
   * Get discovery topic for an entity
   * Uses user-specific discovery prefix so each user only sees their devices
   */
  getDiscoveryTopic(
    type: 'sensor' | 'number' | 'switch' | 'select',
    userId: string,
    deviceId: string,
    entityId: string,
  ): string {
    // Sanitize deviceId for MQTT topic (replace special chars)
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const shortUserId = userId.substring(0, 8);
    // User-specific discovery prefix: homeassistant_ha_6jgAGTN7
    return `${this.discoveryPrefix}_${shortUserId}/${type}/${safeDeviceId}/${entityId}/config`;
  }

  /**
   * Get user-specific discovery prefix for Home Assistant configuration
   */
  getUserDiscoveryPrefix(userId: string): string {
    const shortUserId = userId.substring(0, 8);
    return `${this.discoveryPrefix}_${shortUserId}`;
  }

  /**
   * Entity definitions for each inverter device
   */
  getEntityDefinitions(): HAEntityDefinition[] {
    return [
      // Sensors (read-only)
      {
        type: 'sensor',
        id: 'total_a',
        name: 'Total A',
        valueTemplate: '{{ value_json.totalA | round(4) }}',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        unit: 'kWh',
        icon: 'mdi:flash',
      },
      {
        type: 'sensor',
        id: 'total_a2',
        name: 'Total A2',
        valueTemplate: '{{ value_json.totalA2 | round(4) }}',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        unit: 'kWh',
        icon: 'mdi:flash-outline',
      },
      {
        type: 'sensor',
        id: 'daily_total_a',
        name: 'Daily Total A',
        valueTemplate: '{{ value_json.dailyTotalA | round(4) }}',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        unit: 'kWh',
        icon: 'mdi:calendar-today',
      },
      {
        type: 'sensor',
        id: 'daily_total_a2',
        name: 'Daily Total A2',
        valueTemplate: '{{ value_json.dailyTotalA2 | round(4) }}',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        unit: 'kWh',
        icon: 'mdi:calendar-today-outline',
      },
      {
        type: 'sensor',
        id: 'firmware_version',
        name: 'Firmware Version',
        valueTemplate: '{{ value_json.firmwareVersion }}',
        icon: 'mdi:chip',
        entityCategory: 'diagnostic',
      },
      {
        type: 'sensor',
        id: 'last_update',
        name: 'Last Update',
        valueTemplate: '{{ value_json.updatedAt }}',
        deviceClass: 'timestamp',
        entityCategory: 'diagnostic',
      },

      // Numbers (bidirectional)
      {
        type: 'number',
        id: 'total_a_capacity',
        name: 'Total A Capacity',
        valueTemplate: '{{ value_json.totalACapacity }}',
        min: 0,
        max: 100000,
        step: 1,
        unit: 'Wh',
        mode: 'box',
        icon: 'mdi:gauge',
      },
      {
        type: 'number',
        id: 'total_a2_capacity',
        name: 'Total A2 Capacity',
        valueTemplate: '{{ value_json.totalA2Capacity }}',
        min: 0,
        max: 100000,
        step: 1,
        unit: 'Wh',
        mode: 'box',
        icon: 'mdi:gauge-empty',
      },

      // Switches (bidirectional)
      {
        type: 'switch',
        id: 'schedule_enabled',
        name: 'Schedule Enabled',
        valueTemplate: '{{ value_json.scheduleEnabled }}',
        payloadOn: 'ON',
        payloadOff: 'OFF',
        icon: 'mdi:calendar-clock',
      },

      // Selects (bidirectional)
      {
        type: 'select',
        id: 'operating_mode',
        name: 'Operating Mode',
        valueTemplate: '{{ value_json.operatingMode }}',
        options: ['auto', 'manual', 'eco', 'performance'],
        icon: 'mdi:cog',
      },
    ];
  }
}
