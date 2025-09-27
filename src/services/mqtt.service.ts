/* eslint-disable @typescript-eslint/require-await */

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
  private isInitialized: boolean = false;
  private messageHandlers: Map<string, any> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

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
    this.client.setMaxListeners(20); // Reduced to prevent memory leaks

    // Remove existing listeners to prevent accumulation
    this.client.removeAllListeners();

    this.client.on('connect', () => {
      this.reconnectAttempts = 0; // Reset on successful connect
      this.subscribeToInverterTopics();
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
        console.error('Max MQTT reconnect attempts reached');
        this.client.end();
        return;
      }
      console.log(`MQTT reconnecting attempt ${this.reconnectAttempts}`);
    });

    this.client.on('close', () => {
      console.log('MQTT connection closed');
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
        } else {
        }
      });
    });

    // Remove existing message handlers to prevent accumulation
    this.client.removeAllListeners('message');

    // Single message handler to prevent duplicates
    const messageHandler = (topic: string, message: Buffer) => {
      // Add simple rate limiting to prevent CPU spikes
      if (this.messageHandlers.has(topic)) {
        const lastProcessed = this.messageHandlers.get(topic);
        if (Date.now() - lastProcessed < 1000) { // 1 second minimum between same topic
          return;
        }
      }
      this.messageHandlers.set(topic, Date.now());

      // Clean up old entries to prevent memory leaks
      if (this.messageHandlers.size > 100) {
        const cutoff = Date.now() - 10000; // 10 seconds
        for (const [key, timestamp] of this.messageHandlers.entries()) {
          if (timestamp < cutoff) {
            this.messageHandlers.delete(key);
          }
        }
      }

      const messageStr = message.toString();

      try {
        if (topic.startsWith('inverter/')) {
          // Parse topic to extract device info
          const topicParts = topic.split('/');
          if (topicParts.length >= 4) {
            const currentUid = topicParts[1];
            const wifiSsid = topicParts[2];
            const messageType = topicParts[3];
            // Handle different message types (non-blocking)
            setImmediate(() => {
              void this.handleInverterMessage(
                currentUid,
                wifiSsid,
                messageType,
                messageStr,
              );
            });
          }
        } else if (topic.startsWith('devices/inverter/')) {
          // Handle device topic: devices/inverter/{currentUid}/{wifiSsid}
          const topicParts = topic.split('/');
          if (topicParts.length >= 4) {
            const currentUid = topicParts[2];
            const wifiSsid = topicParts[3];
            setImmediate(() => {
              void this.handleDeviceMessage(currentUid, wifiSsid, messageStr);
            });
          }
        }
      } catch (error) {
        console.error('Error processing MQTT message:', error);
      }
    };

    this.client.on('message', messageHandler);
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
          break;
        case 'schedule':
          break;
        case 'data':
          this.eventEmitter.emit('inverter.data.received', {
            currentUid,
            wifiSsid,
            data,
          });
          break;
        case 'status':
          break;
        default:
      }
    } catch (error) {
    }
  }

  private async handleDeviceMessage(
    currentUid: string,
    wifiSsid: string,
    message: string,
  ) {
    try {
      const data = JSON.parse(message);

      // Emit event for device message
      this.eventEmitter.emit('device.message.received', {
        currentUid,
        wifiSsid,
        data,
      });
    } catch (error) {
      console.error('Error parsing device message:', error);
    }
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
          new Promise((resolve) => setTimeout(resolve, 3000)) // 3 second timeout
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
