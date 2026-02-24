import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as mqtt from 'mqtt';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private isInitialized = false;
  private messageHandlers = new Map<string, number>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    if (this.isInitialized) {
      return;
    }

    // Initialize MQTT connection asynchronously to prevent blocking
    setImmediate(() => {
      this.initializeMqttConnection();
    });

    this.isInitialized = true;
  }

  private initializeMqttConnection() {
    const mqttUrl = this.configService.get<string>(
      'MQTT_URL',
      'mqtt://test.mosquitto.org:1883',
    );
    const clientId = this.configService.get<string>(
      'MQTT_CLIENT_ID',
      'nestjs-app',
    );
    const username = this.configService.get<string>('MQTT_USERNAME');
    const password = this.configService.get<string>('MQTT_PASSWORD');

    const options: mqtt.IClientOptions = {
      clientId: clientId,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      clean: true,
    };

    if (username) {
      options.username = username;
    }
    if (password) {
      options.password = password;
    }

    this.client = mqtt.connect(mqttUrl, options);

    // Register message handler ONCE here (not in subscribeToInverterTopics)
    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });

    this.client.on('connect', () => {
      this.reconnectAttempts = 0;
      this.subscribeToInverterTopics(); // Only subscribes topics now
    });

    this.client.on('error', (error) => {
      console.error('MQTT Error:', error);
    });

    this.client.on('offline', () => {
      console.warn('MQTT client offline');
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts > this.maxReconnectAttempts) {
        this.client.end();
        return;
      }
    });

    this.client.on('close', () => {
      // Connection closed
    });
  }

  // Only subscribe to topics - NO listener registration here
  private subscribeToInverterTopics() {
    const topics = ['inverter/+/+/data', 'devices/inverter/+/+'];
    topics.forEach((topic) => this.client.subscribe(topic));
  }

  // Global message handler - called from the single listener registered in init
  private handleMessage(topic: string, message: Buffer) {
    const topicParts = topic.split('/');
    if (topicParts.length < 4) return;

    const isInverter = topic.startsWith('inverter/');
    const isDevice = topic.startsWith('devices/inverter/');
    if (!isInverter && !isDevice) return;

    const currentUid = isInverter ? topicParts[1] : topicParts[2];
    const wifiSsid = isInverter ? topicParts[2] : topicParts[3];
    const deviceKey = `${currentUid}-${wifiSsid}`;

    // Rate limit: 10 seconds per device
    const now = Date.now();
    const lastProcessed = this.messageHandlers.get(deviceKey);
    if (lastProcessed && now - lastProcessed < 10000) {
      return;
    }
    this.messageHandlers.set(deviceKey, now);

    // Cleanup expired entries (not all) - only when map is large
    if (this.messageHandlers.size > 1000) {
      for (const [key, timestamp] of this.messageHandlers.entries()) {
        if (now - timestamp > 60000) {
          this.messageHandlers.delete(key);
        }
      }
    }

    const messageStr = message.toString();

    if (isInverter && topicParts[3] === 'data') {
      void this.handleInverterMessage(currentUid, wifiSsid, 'data', messageStr);
    } else if (isDevice) {
      void this.handleDeviceMessage(currentUid, wifiSsid, messageStr);
    }
  }

  private handleInverterMessage(
    currentUid: string,
    wifiSsid: string,
    messageType: string,
    message: string,
  ) {
    if (messageType !== 'data') return;

    // Fast extraction using indexOf (faster than regex at scale)
    const value = this.extractStringValue(message, '"value":"');
    if (!value) return;
    const totalACapacity = this.extractNumberValue(
      message,
      '"totalACapacity":',
    );
    const totalA2Capacity = this.extractNumberValue(
      message,
      '"totalA2Capacity":',
    );

    this.eventEmitter.emit('inverter.data.received', {
      currentUid,
      wifiSsid,
      data: { value, totalACapacity, totalA2Capacity },
    });
  }

  // Fast string extraction using indexOf (no regex)
  private extractStringValue(str: string, key: string): string | null {
    const start = str.indexOf(key);
    if (start === -1) return null;
    const valueStart = start + key.length;
    const valueEnd = str.indexOf('"', valueStart);
    if (valueEnd === -1) return null;
    return str.substring(valueStart, valueEnd);
  }

  // Fast number extraction using indexOf (no regex)
  private extractNumberValue(str: string, key: string): number {
    const start = str.indexOf(key);
    if (start === -1) return 0;
    const valueStart = start + key.length;
    let valueEnd = valueStart;
    while (valueEnd < str.length) {
      const c = str.charCodeAt(valueEnd);
      // 0-9 = 48-57, . = 46
      if ((c >= 48 && c <= 57) || c === 46) {
        valueEnd++;
      } else {
        break;
      }
    }
    const num = parseFloat(str.substring(valueStart, valueEnd));
    return Number.isNaN(num) ? 0 : num;
  }

  private handleDeviceMessage(
    currentUid: string,
    wifiSsid: string,
    message: string,
  ) {
    // Fast extraction using indexOf (no regex)
    const deviceName =
      this.extractStringValue(message, '"deviceName":"') || wifiSsid;

    this.eventEmitter.emit('device.message.received', {
      currentUid,
      wifiSsid,
      data: { deviceName },
    });
  }

  async onModuleDestroy() {
    try {
      if (this.client) {
        // Remove all listeners to prevent memory leaks
        this.client.removeAllListeners();

        // Clear message handlers
        this.messageHandlers.clear();

        // Gracefully close connection with timeout
        await Promise.race([
          this.client.endAsync(),
          new Promise((resolve) => setTimeout(resolve, 3000)), // 3 second timeout
        ]);
      }
    } catch (error) {
      console.warn('Error closing MQTT connection:', error);
    }
  }

  // Device events
  async emitDeviceAdded(userId: string, device: unknown) {
    const topic = `user/${userId}/device/added`;
    const payload = {
      userId,
      device,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  async emitDeviceRemoved(userId: string, device: unknown) {
    const topic = `user/${userId}/device/removed`;
    const payload = {
      userId,
      device,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  async emitDeviceUpdated(userId: string, device: unknown) {
    const topic = `user/${userId}/device/updated`;
    const payload = {
      userId,
      device,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  // Setting and data events
  async emitSettingChanged(userId: string, deviceId: string, setting: unknown) {
    const topic = `user/${userId}/device/${deviceId}/setting/changed`;
    const payload = {
      userId,
      deviceId,
      setting,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  async emitDataChanged(userId: string, deviceId: string, data: unknown) {
    const topic = `user/${userId}/device/${deviceId}/data/changed`;
    const payload = {
      userId,
      deviceId,
      data,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  async emitDataAdded(userId: string, deviceId: string, data: unknown) {
    const topic = `user/${userId}/device/${deviceId}/data/added`;
    const payload = {
      userId,
      deviceId,
      data,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
  }

  // Generic publish method
  async publish(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(
        topic,
        JSON.stringify(payload),
        { qos: 1 },
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  }
}
