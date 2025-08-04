/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as mqtt from 'mqtt';
import * as crypto from 'crypto';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private encryptionKey: string;

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.encryptionKey = this.configService.get<string>(
      'MQTT_ENCRYPTION_KEY',
      'default-secret-key',
    );
  }

  onModuleInit() {
    const mqttUrl = this.configService.get<string>(
      'MQTT_URL',
      'mqtt://broker.hivemq.com:1883',
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

    this.client.on('connect', () => {
      console.log(
        `MQTT client connected to ${mqttUrl} with clientId: ${options.clientId}`,
      );
    });

    this.client.on('error', (error) => {
      console.error('MQTT connection error:', error);
      console.error('Connection details:', {
        mqttUrl,
        clientId: options.clientId,
        username,
      });
    });

    this.client.on('offline', () => {
      console.log('MQTT client offline - connection lost');
    });

    this.client.on('reconnect', () => {
      console.log('MQTT client attempting to reconnect...');
    });

    this.client.on('close', () => {
      console.log('MQTT connection closed');
    });

    this.client.on('disconnect', (packet) => {
      console.log('MQTT client disconnected:', packet);
    });

    // Subscribe to inverter topics on connection
    this.client.on('connect', () => {
      this.subscribeToInverterTopics();
    });
  }

  private subscribeToInverterTopics() {
    // Subscribe to all inverter topics using wildcards
    const inverterTopics = [
      'inverter/+/+/setup/value',
      'inverter/+/+/schedule/value',
      'inverter/+/+/data',
      'inverter/+/+/status',
      'devices/inverter/+/+',
    ];

    inverterTopics.forEach((topic) => {
      this.client.subscribe(topic, (err) => {
        if (err) {
          console.error(`Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`Subscribed to ${topic}`);
        }
      });
    });

    // Handle messages for all inverter topics
    this.client.on('message', (topic, message) => {
      const messageStr = message.toString();
      console.log(`Received message on ${topic}:`, messageStr);

      if (topic.startsWith('inverter/')) {
        // Parse topic to extract device info
        const topicParts = topic.split('/');
        if (topicParts.length >= 4) {
          const currentUid = topicParts[1];
          const wifiSsid = topicParts[2];
          const messageType = topicParts[3];
          // Handle different message types
          void this.handleInverterMessage(
            currentUid,
            wifiSsid,
            messageType,
            messageStr,
          );
        }
      } else if (topic.startsWith('devices/inverter/')) {
        // Handle device topic: devices/inverter/{currentUid}/{wifiSsid}
        const topicParts = topic.split('/');
        if (topicParts.length >= 4) {
          const currentUid = topicParts[2];
          const wifiSsid = topicParts[3];
          void this.handleDeviceMessage(currentUid, wifiSsid, messageStr);
        }
      }
    });
  }

  private handleInverterMessage(
    currentUid: string,
    wifiSsid: string,
    messageType: string,
    message: string,
  ) {
    try {
      const data = JSON.parse(message);
      switch (messageType) {
        case 'setup':
          console.log(`Setup data from ${currentUid}/${wifiSsid}:`, data);
          break;
        case 'schedule':
          console.log(`Schedule data from ${currentUid}/${wifiSsid}:`, data);
          break;
        case 'data':
          console.log(`Data from ${currentUid}/${wifiSsid}:`, data);
          this.eventEmitter.emit('inverter.data.received', {
            currentUid,
            wifiSsid,
            data,
          });
          break;
        case 'status':
          console.log(`Status from ${currentUid}/${wifiSsid}:`, data);
          break;
        default:
          console.log(
            `Unknown message type ${messageType} from ${currentUid}/${wifiSsid}:`,
            data,
          );
      }
    } catch (error) {
      console.error('Error parsing inverter message:', error);
      console.log('Raw message:', message);
    }
  }

  private async handleDeviceMessage(
    currentUid: string,
    wifiSsid: string,
    message: string,
  ) {
    try {
      const data = JSON.parse(message);
      console.log(`Device message from ${currentUid}/${wifiSsid}:`, data);

      // Emit event for device message
      this.eventEmitter.emit('device.message.received', {
        currentUid,
        wifiSsid,
        data,
      });
    } catch (error) {
      console.error('Error parsing device message:', error);
      console.log('Raw message:', message);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.endAsync();
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
    console.log(`Published deviceAdded to topic: ${topic}`, device);
  }

  async emitDeviceRemoved(userId: string, device: unknown) {
    const topic = `user/${userId}/device/removed`;
    const payload = {
      userId,
      device,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
    console.log(`Published deviceRemoved to topic: ${topic}`, device);
  }

  async emitDeviceUpdated(userId: string, device: unknown) {
    const topic = `user/${userId}/device/updated`;
    const payload = {
      userId,
      device,
      timestamp: new Date().toISOString(),
    };

    await this.publish(topic, payload);
    console.log(`Published deviceUpdated to topic: ${topic}`, device);
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
    console.log(`Published settingChanged to topic: ${topic}`, setting);
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
    console.log(`Published dataChanged to topic: ${topic}`, data);
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
    console.log(`Published dataAdded to topic: ${topic}`, data);
  }

  // Generic publish method
  private async publish(
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

  // Decrypt message using AES-256-GCM with SHA256-derived key
  private decryptMessage(encryptedData: string): string {
    try {
      // Create SHA256 hash of the encryption key
      const keyHash = crypto
        .createHash('sha256')
        .update(this.encryptionKey)
        .digest();

      // Parse the encrypted data (format: iv:authTag:encryptedText)
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted message format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');

      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Error decrypting message:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  // Encrypt message using AES-256-GCM with SHA256-derived key
  private encryptMessage(data: string): string {
    try {
      // Create SHA256 hash of the encryption key
      const keyHash = crypto
        .createHash('sha256')
        .update(this.encryptionKey)
        .digest();

      // Generate random IV
      const iv = crypto.randomBytes(16);

      // Create cipher
      const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);

      // Encrypt
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Return format: iv:authTag:encryptedText
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('Error encrypting message:', error);
      throw new Error('Failed to encrypt message');
    }
  }

  // Subscribe to topics with automatic decryption
  subscribe(
    topic: string,
    callback: (topic: string, message: Record<string, unknown>) => void,
    encrypted: boolean = true,
  ) {
    this.client.subscribe(topic);
    this.client.on('message', (receivedTopic, message) => {
      if (receivedTopic === topic) {
        try {
          let messageStr = message.toString();

          // Decrypt message if it's encrypted
          if (encrypted) {
            messageStr = this.decryptMessage(messageStr);
          }

          const payload = JSON.parse(messageStr) as Record<string, unknown>;
          callback(receivedTopic, payload);
        } catch (error) {
          console.error('Error processing MQTT message:', error);
        }
      }
    });
  }

  // Subscribe to topics with raw message handling
  subscribeRaw(
    topic: string,
    callback: (topic: string, message: string, decrypted?: string) => void,
    encrypted: boolean = true,
  ) {
    this.client.subscribe(topic);
    this.client.on('message', (receivedTopic, message) => {
      if (receivedTopic === topic) {
        const rawMessage = message.toString();
        let decryptedMessage: string | undefined;

        if (encrypted) {
          try {
            decryptedMessage = this.decryptMessage(rawMessage);
          } catch (error) {
            console.error('Error decrypting message:', error);
          }
        }

        callback(receivedTopic, rawMessage, decryptedMessage);
      }
    });
  }
}
