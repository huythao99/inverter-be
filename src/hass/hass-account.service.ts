import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MqttAuthService } from '../services/mqtt-auth.service';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';
import {
  availabilityTopic,
  bridgeConfig,
  HASS_STATE_ROOT,
  hassEnabled,
  HassKind,
  hassPrefixFor,
  stateTopic,
} from './hass-discovery';
import { HASS_ACTIVE_MS, HassBridgeService } from './hass-bridge.service';

export interface HassConfig {
  /** False when the feature is switched off server-wide (HASS_ENABLED). */
  available: boolean;
  enabled: boolean;
  /** Home Assistant seen by the broker in the last 15 min. */
  connected: boolean;
  lastSeenAt: string | null;
  broker: string;
  port: number;
  ssl: boolean;
  username?: string;
  password?: string;
  discoveryPrefix?: string;
  stateTopicPrefix?: string;
  /** mosquitto.conf snippet for option B (bridge from the user's broker). */
  bridgeConfig?: string;
  devices: Array<{
    kind: HassKind;
    deviceId: string;
    deviceName: string;
    stateTopic: string;
    availabilityTopic: string;
  }>;
}

/** Enable / disable / show the Home Assistant access of a user. */
@Injectable()
export class HassAccountService {
  private readonly host: string;
  private readonly port: number;
  private readonly ssl: boolean;

  constructor(
    private readonly mqttAuth: MqttAuthService,
    private readonly bridge: HassBridgeService,
    config: ConfigService,
    @InjectModel(InverterDevice.name)
    private readonly inverterModel: Model<InverterDeviceDocument>,
    @InjectModel(ChargerDevice.name)
    private readonly chargerModel: Model<ChargerDeviceDocument>,
  ) {
    this.host =
      config.get<string>('HA_MQTT_HOST') ||
      config.get<string>('MQTT_BROKER_HOST') ||
      'giabao-inverter.com';
    this.port = Number(config.get('HA_MQTT_PORT') ?? 8883);
    this.ssl = String(config.get('HA_MQTT_SSL') ?? 'true') !== 'false';
  }

  private async devices(uid: string): Promise<HassConfig['devices']> {
    const [inv, chg] = await Promise.all([
      this.inverterModel
        .find({ userId: uid })
        .select({ deviceId: 1, deviceName: 1 })
        .lean()
        .exec(),
      this.chargerModel
        .find({ userId: uid })
        .select({ deviceId: 1, deviceName: 1 })
        .lean()
        .exec(),
    ]);
    const row = (
      kind: HassKind,
      d: { deviceId: string; deviceName?: string },
    ) => ({
      kind,
      deviceId: d.deviceId,
      deviceName: d.deviceName || d.deviceId,
      stateTopic: stateTopic(uid, d.deviceId),
      availabilityTopic: availabilityTopic(uid, d.deviceId),
    });
    return [
      ...inv.map((d) => row('inverter', d)),
      ...chg.map((d) => row('charger', d)),
    ];
  }

  async get(uid: string): Promise<HassConfig> {
    const cred = await this.mqttAuth.getHaCredential(uid);
    const base = {
      available: hassEnabled(),
      broker: this.host,
      port: this.port,
      ssl: this.ssl,
      devices: await this.devices(uid),
    };
    if (!cred || !cred.isActive) {
      return { ...base, enabled: false, connected: false, lastSeenAt: null };
    }
    const password = this.mqttAuth.revealPassword(cred);
    const prefix = hassPrefixFor(cred.mqttUsername);
    const seen = cred.lastUsedAt ? new Date(cred.lastUsedAt) : null;
    return {
      ...base,
      enabled: true,
      connected: !!seen && Date.now() - seen.getTime() < HASS_ACTIVE_MS,
      lastSeenAt: seen ? seen.toISOString() : null,
      username: cred.mqttUsername,
      password,
      discoveryPrefix: prefix,
      stateTopicPrefix: `${HASS_STATE_ROOT}/${uid}`,
      bridgeConfig: bridgeConfig({
        host: this.host,
        port: this.port,
        username: cred.mqttUsername,
        password,
        prefix,
        uid,
      }),
    };
  }

  async enable(uid: string): Promise<HassConfig> {
    if (!hassEnabled()) {
      throw new ServiceUnavailableException(
        'Tính năng Home Assistant đang tạm ngưng',
      );
    }
    await this.mqttAuth.enableHa(uid);
    return this.get(uid);
  }

  async disable(uid: string): Promise<HassConfig> {
    const cred = await this.mqttAuth.getHaCredential(uid);
    await this.mqttAuth.revokeAccess(uid);
    if (cred) await this.bridge.clearUser(uid, cred.mqttUsername);
    return this.get(uid);
  }

  async regenerate(uid: string): Promise<HassConfig> {
    const cred = await this.mqttAuth.getHaCredential(uid);
    if (!cred?.isActive) {
      throw new BadRequestException('Home Assistant chưa được bật');
    }
    await this.mqttAuth.regeneratePassword(uid);
    return this.get(uid);
  }
}
