import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MqttService } from './mqtt.service';
import { HomeAssistantConfig } from '../config/home-assistant.config';
import {
  HADeviceInfo,
  HADiscoveryPayload,
  HASensorDiscoveryPayload,
  HANumberDiscoveryPayload,
  HASwitchDiscoveryPayload,
  HASelectDiscoveryPayload,
  HADeviceState,
  HABridgeState,
  HACommand,
  HAEntityDefinition,
  InverterDeviceData,
} from '../interfaces/home-assistant.interface';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  InverterData,
  InverterDataDocument,
} from '../models/inverter-data.schema';
import {
  DailyTotals,
  DailyTotalsDocument,
} from '../models/daily-totals.schema';
import {
  InverterSetting,
  InverterSettingDocument,
} from '../models/inverter-setting.schema';
import {
  InverterSchedule,
  InverterScheduleDocument,
} from '../models/inverter-schedule.schema';

@Injectable()
export class HomeAssistantService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HomeAssistantService.name);
  private statePublishTimer: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private discoveredDevices = new Set<string>();

  constructor(
    private mqttService: MqttService,
    private haConfig: HomeAssistantConfig,
    private eventEmitter: EventEmitter2,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
    @InjectModel(InverterData.name)
    private inverterDataModel: Model<InverterDataDocument>,
    @InjectModel(DailyTotals.name)
    private dailyTotalsModel: Model<DailyTotalsDocument>,
    @InjectModel(InverterSetting.name)
    private inverterSettingModel: Model<InverterSettingDocument>,
    @InjectModel(InverterSchedule.name)
    private inverterScheduleModel: Model<InverterScheduleDocument>,
  ) {}

  async onModuleInit() {
    if (!this.haConfig.isEnabled) {
      this.logger.log('Home Assistant discovery is disabled');
      return;
    }

    // Delay initialization to allow MQTT connection
    setTimeout(async () => {
      await this.initialize();
    }, 5000);
  }

  async onModuleDestroy() {
    if (this.statePublishTimer) {
      clearInterval(this.statePublishTimer);
      this.statePublishTimer = null;
    }

    // Publish offline status
    await this.publishBridgeAvailability(false);
  }

  private async initialize() {
    this.logger.log('Initializing Home Assistant integration...');

    // Publish bridge availability
    await this.publishBridgeAvailability(true);

    // Discover all existing devices
    await this.discoverAllDevices();

    // Start periodic state publishing
    this.startStatePublishing();

    this.logger.log('Home Assistant integration initialized');
  }

  /**
   * Discover all existing devices and publish their discovery configs
   */
  private async discoverAllDevices() {
    try {
      const devices = await this.inverterDeviceModel.find().lean().exec();

      for (const device of devices) {
        await this.publishDeviceDiscovery(device.userId, device.deviceId, {
          deviceName: device.deviceName,
          firmwareVersion: device.firmwareVersion || '1.0.0',
        });
      }

      this.logger.log(`Discovered ${devices.length} devices for Home Assistant`);
    } catch (error) {
      this.logger.error('Failed to discover devices', error);
    }
  }

  /**
   * Publish discovery configuration for a device
   */
  async publishDeviceDiscovery(
    userId: string,
    deviceId: string,
    deviceInfo: { deviceName: string; firmwareVersion?: string },
  ) {
    const deviceKey = `${userId}:${deviceId}`;

    // Create device info for HA
    const haDevice: HADeviceInfo = {
      identifiers: [`inverter_${userId}_${deviceId}`],
      name: deviceInfo.deviceName || deviceId,
      manufacturer: this.haConfig.manufacturer,
      model: this.haConfig.model,
      sw_version: deviceInfo.firmwareVersion || '1.0.0',
      via_device: this.haConfig.bridgeDeviceId,
    };

    const entities = this.haConfig.getEntityDefinitions();
    const stateTopic = this.haConfig.getStateTopic(userId, deviceId);
    const availabilityTopic = this.haConfig.getAvailabilityTopic(userId, deviceId);

    for (const entity of entities) {
      const uniqueId = `inverter_${userId}_${deviceId}_${entity.id}`;
      const entityName = `${deviceInfo.deviceName || deviceId} ${entity.name}`;

      let payload: HADiscoveryPayload | null = null;

      switch (entity.type) {
        case 'sensor':
          payload = this.createSensorPayload(
            entity,
            uniqueId,
            entityName,
            haDevice,
            stateTopic,
            availabilityTopic,
          );
          break;
        case 'number':
          payload = this.createNumberPayload(
            entity,
            uniqueId,
            entityName,
            haDevice,
            stateTopic,
            availabilityTopic,
            this.haConfig.getCommandTopic(userId, deviceId, entity.id),
          );
          break;
        case 'switch':
          payload = this.createSwitchPayload(
            entity,
            uniqueId,
            entityName,
            haDevice,
            stateTopic,
            availabilityTopic,
            this.haConfig.getCommandTopic(userId, deviceId, entity.id),
          );
          break;
        case 'select':
          payload = this.createSelectPayload(
            entity,
            uniqueId,
            entityName,
            haDevice,
            stateTopic,
            availabilityTopic,
            this.haConfig.getCommandTopic(userId, deviceId, entity.id),
          );
          break;
        default:
          continue;
      }

      if (!payload) continue;

      const discoveryTopic = this.haConfig.getDiscoveryTopic(
        entity.type,
        `${userId}_${deviceId}`,
        entity.id,
      );

      await this.mqttService.publishWithRetain(discoveryTopic, payload, true);
    }

    // Publish device availability
    await this.publishDeviceAvailability(userId, deviceId, true);

    this.discoveredDevices.add(deviceKey);
    this.logger.debug(`Published discovery for device: ${deviceKey}`);
  }

  private createSensorPayload(
    entity: HAEntityDefinition,
    uniqueId: string,
    name: string,
    device: HADeviceInfo,
    stateTopic: string,
    availabilityTopic: string,
  ): HASensorDiscoveryPayload {
    const payload: HASensorDiscoveryPayload = {
      name,
      unique_id: uniqueId,
      device,
      state_topic: stateTopic,
      availability_topic: availabilityTopic,
      value_template: entity.valueTemplate,
      payload_available: 'online',
      payload_not_available: 'offline',
    };

    if (entity.deviceClass) payload.device_class = entity.deviceClass;
    if (entity.stateClass) payload.state_class = entity.stateClass;
    if (entity.unit) payload.unit_of_measurement = entity.unit;
    if (entity.icon) payload.icon = entity.icon;
    if (entity.entityCategory) payload.entity_category = entity.entityCategory;

    return payload;
  }

  private createNumberPayload(
    entity: HAEntityDefinition,
    uniqueId: string,
    name: string,
    device: HADeviceInfo,
    stateTopic: string,
    availabilityTopic: string,
    commandTopic: string,
  ): HANumberDiscoveryPayload {
    const payload: HANumberDiscoveryPayload = {
      name,
      unique_id: uniqueId,
      device,
      state_topic: stateTopic,
      command_topic: commandTopic,
      availability_topic: availabilityTopic,
      value_template: entity.valueTemplate,
      min: entity.min ?? 0,
      max: entity.max ?? 100000,
      payload_available: 'online',
      payload_not_available: 'offline',
    };

    if (entity.step) payload.step = entity.step;
    if (entity.unit) payload.unit_of_measurement = entity.unit;
    if (entity.mode) payload.mode = entity.mode;
    if (entity.icon) payload.icon = entity.icon;

    return payload;
  }

  private createSwitchPayload(
    entity: HAEntityDefinition,
    uniqueId: string,
    name: string,
    device: HADeviceInfo,
    stateTopic: string,
    availabilityTopic: string,
    commandTopic: string,
  ): HASwitchDiscoveryPayload {
    return {
      name,
      unique_id: uniqueId,
      device,
      state_topic: stateTopic,
      command_topic: commandTopic,
      availability_topic: availabilityTopic,
      value_template: entity.valueTemplate,
      payload_on: entity.payloadOn ?? 'ON',
      payload_off: entity.payloadOff ?? 'OFF',
      state_on: 'ON',
      state_off: 'OFF',
      icon: entity.icon,
      payload_available: 'online',
      payload_not_available: 'offline',
    };
  }

  private createSelectPayload(
    entity: HAEntityDefinition,
    uniqueId: string,
    name: string,
    device: HADeviceInfo,
    stateTopic: string,
    availabilityTopic: string,
    commandTopic: string,
  ): HASelectDiscoveryPayload {
    return {
      name,
      unique_id: uniqueId,
      device,
      state_topic: stateTopic,
      command_topic: commandTopic,
      availability_topic: availabilityTopic,
      value_template: entity.valueTemplate,
      options: entity.options ?? [],
      icon: entity.icon,
      payload_available: 'online',
      payload_not_available: 'offline',
    };
  }

  /**
   * Publish device availability status
   */
  async publishDeviceAvailability(
    userId: string,
    deviceId: string,
    online: boolean,
  ) {
    const topic = this.haConfig.getAvailabilityTopic(userId, deviceId);
    await this.mqttService.publishWithRetain(
      topic,
      online ? 'online' : 'offline',
      true,
    );
  }

  /**
   * Publish bridge availability status
   */
  async publishBridgeAvailability(online: boolean) {
    const topic = this.haConfig.getBridgeAvailabilityTopic();
    await this.mqttService.publishWithRetain(
      topic,
      online ? 'online' : 'offline',
      true,
    );
  }

  /**
   * Publish device state to Home Assistant
   */
  async publishDeviceState(userId: string, deviceId: string) {
    try {
      const deviceData = await this.getDeviceData(userId, deviceId);
      if (!deviceData) return;

      const state = this.buildDeviceState(deviceData);
      const topic = this.haConfig.getStateTopic(userId, deviceId);

      await this.mqttService.publishWithRetain(topic, state, false);
    } catch (error) {
      this.logger.error(
        `Failed to publish state for ${userId}/${deviceId}`,
        error,
      );
    }
  }

  /**
   * Get all device data needed for state publishing
   */
  private async getDeviceData(
    userId: string,
    deviceId: string,
  ): Promise<InverterDeviceData | null> {
    const [device, data, dailyTotals, setting, schedule] = await Promise.all([
      this.inverterDeviceModel.findOne({ userId, deviceId }).lean().exec(),
      this.inverterDataModel.findOne({ userId, deviceId }).lean().exec(),
      this.getTodayDailyTotals(userId, deviceId),
      this.inverterSettingModel.findOne({ userId, deviceId }).lean().exec(),
      this.inverterScheduleModel.findOne({ userId, deviceId }).lean().exec(),
    ]);

    if (!device) return null;

    return {
      userId,
      deviceId,
      deviceName: device.deviceName,
      firmwareVersion: device.firmwareVersion || '1.0.0',
      value: data?.value,
      totalACapacity: data?.totalACapacity ?? 0,
      totalA2Capacity: data?.totalA2Capacity ?? 0,
      dailyTotalA: dailyTotals?.totalA ?? 0,
      dailyTotalA2: dailyTotals?.totalA2 ?? 0,
      scheduleEnabled: this.isScheduleEnabled(schedule?.schedule),
      operatingMode: this.getOperatingMode(setting?.value),
      setting: setting?.value,
      schedule: schedule?.schedule,
      updatedAt: device.updatedAt || new Date(),
    };
  }

  /**
   * Get today's daily totals for a device
   */
  private async getTodayDailyTotals(
    userId: string,
    deviceId: string,
  ): Promise<{ totalA: number; totalA2: number } | null> {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const gmt7 = new Date(utc + 7 * 3600000);
    gmt7.setHours(0, 0, 0, 0);

    const endOfDay = new Date(gmt7);
    endOfDay.setHours(23, 59, 59, 999);

    const dailyTotals = await this.dailyTotalsModel
      .findOne({
        userId,
        deviceId,
        date: { $gte: gmt7, $lte: endOfDay },
        deletedAt: null,
      })
      .lean()
      .exec();

    return dailyTotals;
  }

  /**
   * Parse schedule string to determine if enabled
   */
  private isScheduleEnabled(schedule?: string): boolean {
    if (!schedule) return false;
    try {
      const parsed = JSON.parse(schedule);
      return parsed.enabled === true || parsed.enabled === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Parse setting string to get operating mode
   */
  private getOperatingMode(setting?: string): string {
    if (!setting) return 'auto';
    try {
      const parsed = JSON.parse(setting);
      return parsed.mode || parsed.operatingMode || 'auto';
    } catch {
      return 'auto';
    }
  }

  /**
   * Build HADeviceState from device data
   */
  private buildDeviceState(data: InverterDeviceData): HADeviceState {
    // Parse totalA and totalA2 from value string
    const totals = this.parseTotalsFromValue(data.value);

    return {
      totalA: totals.totalA,
      totalA2: totals.totalA2,
      dailyTotalA: data.dailyTotalA,
      dailyTotalA2: data.dailyTotalA2,
      totalACapacity: data.totalACapacity,
      totalA2Capacity: data.totalA2Capacity,
      firmwareVersion: data.firmwareVersion,
      deviceName: data.deviceName,
      scheduleEnabled: data.scheduleEnabled ? 'ON' : 'OFF',
      operatingMode: data.operatingMode,
      updatedAt: data.updatedAt.toISOString(),
    };
  }

  /**
   * Parse totals from value string (same logic as inverter-data.service)
   */
  private parseTotalsFromValue(value?: string): {
    totalA: number;
    totalA2: number;
  } {
    if (!value || typeof value !== 'string') return { totalA: 0, totalA2: 0 };
    try {
      const parts = value.split('#');
      if (parts.length >= 10) {
        const totalA = parseFloat(parts[parts.length - 2]) || 0;
        const totalA2 = parseFloat(parts[parts.length - 1]) || 0;
        return {
          totalA: isFinite(totalA) ? totalA / 1000000 : 0,
          totalA2: isFinite(totalA2) ? totalA2 / 1000000 : 0,
        };
      }
    } catch {
      // Parsing failed
    }
    return { totalA: 0, totalA2: 0 };
  }

  /**
   * Publish bridge state
   */
  async publishBridgeState() {
    const devicesCount = await this.inverterDeviceModel.countDocuments().exec();

    const state: HABridgeState = {
      state: 'online',
      version: '1.0.0',
      devices_count: devicesCount,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      last_update: new Date().toISOString(),
    };

    const topic = this.haConfig.getBridgeStateTopic();
    await this.mqttService.publishWithRetain(topic, state, false);
  }

  /**
   * Start periodic state publishing
   */
  private startStatePublishing() {
    const interval = this.haConfig.statePublishInterval;

    this.statePublishTimer = setInterval(async () => {
      await this.publishAllDeviceStates();
      await this.publishBridgeState();
    }, interval);

    // Publish initial state
    setTimeout(async () => {
      await this.publishAllDeviceStates();
      await this.publishBridgeState();
    }, 2000);
  }

  /**
   * Publish state for all devices
   */
  private async publishAllDeviceStates() {
    try {
      const devices = await this.inverterDeviceModel.find().lean().exec();

      for (const device of devices) {
        await this.publishDeviceState(device.userId, device.deviceId);
      }
    } catch (error) {
      this.logger.error('Failed to publish all device states', error);
    }
  }

  /**
   * Handle command from Home Assistant
   */
  @OnEvent('ha.command.received')
  async handleHACommand(command: HACommand) {
    this.logger.log(
      `Received HA command: ${command.entity} = ${command.value} for ${command.userId}/${command.deviceId}`,
    );

    try {
      switch (command.entity) {
        case 'total_a_capacity':
          await this.handleCapacityUpdate(
            command.userId,
            command.deviceId,
            'totalACapacity',
            Number(command.value),
          );
          break;
        case 'total_a2_capacity':
          await this.handleCapacityUpdate(
            command.userId,
            command.deviceId,
            'totalA2Capacity',
            Number(command.value),
          );
          break;
        case 'schedule_enabled':
          await this.handleScheduleEnabledUpdate(
            command.userId,
            command.deviceId,
            command.value === 'ON',
          );
          break;
        case 'operating_mode':
          await this.handleOperatingModeUpdate(
            command.userId,
            command.deviceId,
            String(command.value),
          );
          break;
        default:
          this.logger.warn(`Unknown HA command entity: ${command.entity}`);
      }

      // Republish state after handling command
      await this.publishDeviceState(command.userId, command.deviceId);
    } catch (error) {
      this.logger.error('Failed to handle HA command', error);
    }
  }

  private async handleCapacityUpdate(
    userId: string,
    deviceId: string,
    field: 'totalACapacity' | 'totalA2Capacity',
    value: number,
  ) {
    await this.inverterDataModel.updateOne(
      { userId, deviceId },
      { $set: { [field]: value, updatedAt: new Date() } },
      { upsert: true },
    );

    // Emit event for other services
    this.eventEmitter.emit('inverter.capacity.updated', {
      userId,
      deviceId,
      field,
      value,
    });
  }

  private async handleScheduleEnabledUpdate(
    userId: string,
    deviceId: string,
    enabled: boolean,
  ) {
    const existing = await this.inverterScheduleModel
      .findOne({ userId, deviceId })
      .lean()
      .exec();

    let schedule: Record<string, unknown> = {};
    if (existing?.schedule) {
      try {
        schedule = JSON.parse(existing.schedule);
      } catch {
        // Invalid JSON
      }
    }

    schedule.enabled = enabled;

    await this.inverterScheduleModel.updateOne(
      { userId, deviceId },
      { $set: { schedule: JSON.stringify(schedule), updatedAt: new Date() } },
      { upsert: true },
    );

    // Emit event for other services
    this.eventEmitter.emit('inverter.schedule.updated', {
      userId,
      deviceId,
      enabled,
    });
  }

  private async handleOperatingModeUpdate(
    userId: string,
    deviceId: string,
    mode: string,
  ) {
    const existing = await this.inverterSettingModel
      .findOne({ userId, deviceId })
      .lean()
      .exec();

    let setting: Record<string, unknown> = {};
    if (existing?.value) {
      try {
        setting = JSON.parse(existing.value);
      } catch {
        // Invalid JSON
      }
    }

    setting.mode = mode;
    setting.operatingMode = mode;

    await this.inverterSettingModel.updateOne(
      { userId, deviceId },
      { $set: { value: JSON.stringify(setting), updatedAt: new Date() } },
      { upsert: true },
    );

    // Emit event for other services
    this.eventEmitter.emit('inverter.mode.updated', {
      userId,
      deviceId,
      mode,
    });
  }

  /**
   * Handle new device added - publish discovery
   */
  @OnEvent('device.message.received')
  async handleDeviceAdded(payload: {
    currentUid: string;
    wifiSsid: string;
    data: { deviceName?: string };
  }) {
    const deviceKey = `${payload.currentUid}:${payload.wifiSsid}`;

    // Only publish discovery if not already discovered
    if (!this.discoveredDevices.has(deviceKey)) {
      await this.publishDeviceDiscovery(
        payload.currentUid,
        payload.wifiSsid,
        {
          deviceName: payload.data.deviceName || payload.wifiSsid,
          firmwareVersion: '1.0.0',
        },
      );
    }
  }

  /**
   * Handle inverter data received - publish state update
   */
  @OnEvent('inverter.data.received')
  async handleInverterDataReceived(payload: {
    currentUid: string;
    wifiSsid: string;
  }) {
    // Publish state update for this device
    await this.publishDeviceState(payload.currentUid, payload.wifiSsid);
  }
}
