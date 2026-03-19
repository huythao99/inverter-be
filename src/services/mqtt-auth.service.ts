import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  MqttCredential,
  MqttCredentialDocument,
} from '../models/mqtt-credential.schema';

export interface HAMqttConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
  ssl: boolean;
  discoveryPrefix: string;
  stateTopicPrefix: string;
  devices: Array<{
    deviceId: string;
    deviceName: string;
    stateTopic: string;
    availabilityTopic: string;
  }>;
}

@Injectable()
export class MqttAuthService {
  private readonly logger = new Logger(MqttAuthService.name);
  private readonly encryptionKey: string;
  private readonly mqttBroker: string;
  private readonly mqttPort: number;
  private readonly statePrefix: string;

  constructor(
    @InjectModel(MqttCredential.name)
    private mqttCredentialModel: Model<MqttCredentialDocument>,
    private configService: ConfigService,
  ) {
    this.encryptionKey = this.configService.get<string>(
      'MQTT_AUTH_SECRET',
      'K8mN2pQ7vX4bE9fH3gJ6kL1mP5sT8wZ2',
    );
    this.mqttBroker = this.configService.get<string>(
      'MQTT_BROKER_HOST',
      'giabao-inverter.com',
    );
    this.mqttPort = this.configService.get<number>('MQTT_BROKER_PORT', 1883);
    this.statePrefix = this.configService.get<string>(
      'HA_STATE_PREFIX',
      'inverter_ha',
    );
  }

  /**
   * Generate a secure random password
   */
  private generatePassword(length: number = 16): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      password += chars[randomBytes[i] % chars.length];
    }
    return password;
  }

  /**
   * Generate a unique MQTT username from userId
   */
  private generateMqttUsername(userId: string): string {
    // Take first 8 chars of userId and add prefix
    const shortId = userId.substring(0, 8);
    return `ha_${shortId}`;
  }

  /**
   * Hash password using SHA256
   */
  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Encrypt password for storage (can be decrypted for display)
   */
  private encryptPassword(password: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto
      .createHash('sha256')
      .update(this.encryptionKey)
      .digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt password for display to user
   */
  private decryptPassword(encryptedPassword: string): string {
    try {
      const [ivHex, encrypted] = encryptedPassword.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const key = crypto
        .createHash('sha256')
        .update(this.encryptionKey)
        .digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      this.logger.error('Failed to decrypt password', error);
      return '';
    }
  }

  /**
   * Generate or get existing credentials for a user
   */
  async getOrCreateCredentials(userId: string): Promise<MqttCredentialDocument> {
    const existingCredential = await this.mqttCredentialModel
      .findOne({ userId, isActive: true })
      .exec();

    if (existingCredential) {
      return existingCredential;
    }

    return this.generateCredentials(userId);
  }

  /**
   * Generate new credentials for a user
   */
  async generateCredentials(userId: string): Promise<MqttCredentialDocument> {
    const password = this.generatePassword();
    const mqttUsername = this.generateMqttUsername(userId);

    // Check if username already exists (collision)
    const existing = await this.mqttCredentialModel
      .findOne({ mqttUsername })
      .exec();

    // If exists for different user, add random suffix
    const finalUsername = existing
      ? `${mqttUsername}_${crypto.randomBytes(2).toString('hex')}`
      : mqttUsername;

    const credential = await this.mqttCredentialModel.findOneAndUpdate(
      { userId },
      {
        userId,
        mqttUsername: finalUsername,
        mqttPasswordHash: this.hashPassword(password),
        mqttPasswordEncrypted: this.encryptPassword(password),
        isActive: true,
        updatedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    this.logger.log(`Generated MQTT credentials for user: ${userId}`);
    return credential!;
  }

  /**
   * Regenerate password for existing user
   */
  async regeneratePassword(userId: string): Promise<MqttCredentialDocument> {
    const credential = await this.mqttCredentialModel
      .findOne({ userId })
      .exec();

    if (!credential) {
      return this.generateCredentials(userId);
    }

    const newPassword = this.generatePassword();

    credential.mqttPasswordHash = this.hashPassword(newPassword);
    credential.mqttPasswordEncrypted = this.encryptPassword(newPassword);
    credential.updatedAt = new Date();
    await credential.save();

    this.logger.log(`Regenerated MQTT password for user: ${userId}`);
    return credential;
  }

  /**
   * Validate MQTT credentials (called by Mosquitto auth plugin)
   */
  async validateCredentials(
    username: string,
    password: string,
  ): Promise<boolean> {
    const credential = await this.mqttCredentialModel
      .findOne({ mqttUsername: username, isActive: true })
      .exec();

    if (!credential) {
      this.logger.debug(`MQTT auth failed: username not found - ${username}`);
      return false;
    }

    const passwordHash = this.hashPassword(password);
    const isValid = credential.mqttPasswordHash === passwordHash;

    if (isValid) {
      // Update last used timestamp (non-blocking)
      this.mqttCredentialModel
        .updateOne({ _id: credential._id }, { lastUsedAt: new Date() })
        .exec()
        .catch(() => {});
    } else {
      this.logger.debug(`MQTT auth failed: invalid password - ${username}`);
    }

    return isValid;
  }

  /**
   * Check if user can access a topic (ACL check)
   * Called by Mosquitto auth plugin
   */
  async checkAcl(
    username: string,
    topic: string,
    access: 'read' | 'write' | 'subscribe',
  ): Promise<boolean> {
    const credential = await this.mqttCredentialModel
      .findOne({ mqttUsername: username, isActive: true })
      .exec();

    if (!credential) {
      return false;
    }

    const userId = credential.userId;

    // Allow reading homeassistant discovery topics (everyone can read)
    if (topic.startsWith('homeassistant/') && access !== 'write') {
      return true;
    }

    // Allow reading/writing user's own topics
    // inverter_ha/{userId}/...
    const userTopicPrefix = `${this.statePrefix}/${userId}/`;
    if (topic.startsWith(userTopicPrefix)) {
      // For write access, only allow /set/ topics
      if (access === 'write') {
        return topic.includes('/set/');
      }
      return true;
    }

    // Allow bridge topics (read only)
    if (
      topic.startsWith(`${this.statePrefix}/bridge/`) &&
      access !== 'write'
    ) {
      return true;
    }

    this.logger.debug(
      `ACL denied: ${username} cannot ${access} topic ${topic}`,
    );
    return false;
  }

  /**
   * Add a device to user's allowed list
   */
  async addAllowedDevice(userId: string, deviceId: string): Promise<void> {
    await this.mqttCredentialModel.updateOne(
      { userId },
      {
        $addToSet: { allowedDevices: deviceId },
        $set: { updatedAt: new Date() },
      },
    );
  }

  /**
   * Remove a device from user's allowed list
   */
  async removeAllowedDevice(userId: string, deviceId: string): Promise<void> {
    await this.mqttCredentialModel.updateOne(
      { userId },
      {
        $pull: { allowedDevices: deviceId },
        $set: { updatedAt: new Date() },
      },
    );
  }

  /**
   * Get Home Assistant MQTT configuration for a user
   */
  async getHAConfig(
    userId: string,
    devices?: Array<{ deviceId: string; deviceName: string }>,
  ): Promise<HAMqttConfig | null> {
    const credential = await this.getOrCreateCredentials(userId);

    if (!credential) {
      return null;
    }

    const password = this.decryptPassword(credential.mqttPasswordEncrypted);

    const deviceConfigs = (devices || []).map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      stateTopic: `${this.statePrefix}/${userId}/${device.deviceId}/state`,
      availabilityTopic: `${this.statePrefix}/${userId}/${device.deviceId}/availability`,
    }));

    return {
      broker: this.mqttBroker,
      port: this.mqttPort,
      username: credential.mqttUsername,
      password,
      ssl: false,
      discoveryPrefix: 'homeassistant',
      stateTopicPrefix: `${this.statePrefix}/${userId}`,
      devices: deviceConfigs,
    };
  }

  /**
   * Revoke user's MQTT access
   */
  async revokeAccess(userId: string): Promise<void> {
    await this.mqttCredentialModel.updateOne(
      { userId },
      { isActive: false, updatedAt: new Date() },
    );
    this.logger.log(`Revoked MQTT access for user: ${userId}`);
  }

  /**
   * Get credential by userId
   */
  async getCredentialByUserId(userId: string): Promise<MqttCredential | null> {
    return this.mqttCredentialModel
      .findOne({ userId, isActive: true })
      .exec();
  }

  /**
   * Get credential by MQTT username
   */
  async getCredentialByUsername(
    username: string,
  ): Promise<MqttCredential | null> {
    return this.mqttCredentialModel
      .findOne({ mqttUsername: username, isActive: true })
      .exec();
  }

  /**
   * Generate password file content for Mosquitto
   * Format: username:password_hash (one per line)
   *
   * Note: Mosquitto uses PBKDF2-SHA512 for password hashing.
   * This generates a format that can be used with `mosquitto_passwd -U`
   */
  async generatePasswordFileContent(): Promise<string> {
    const credentials = await this.mqttCredentialModel
      .find({ isActive: true })
      .exec();

    const lines: string[] = [];
    for (const cred of credentials) {
      const password = this.decryptPassword(cred.mqttPasswordEncrypted);
      // Format: username:password (plain text - run mosquitto_passwd -U to hash)
      lines.push(`${cred.mqttUsername}:${password}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate ACL file content for Mosquitto
   * Format:
   *   user <username>
   *   topic read <pattern>
   *   topic write <pattern>
   */
  async generateAclFileContent(): Promise<string> {
    const credentials = await this.mqttCredentialModel
      .find({ isActive: true })
      .exec();

    const lines: string[] = [
      '# Auto-generated ACL file by NestJS',
      '# Do not edit manually - changes will be overwritten',
      '',
      '# Allow all users to read homeassistant discovery topics',
      'pattern read homeassistant/#',
      '',
      '# Allow all users to read bridge status',
      `pattern read ${this.statePrefix}/bridge/#`,
      '',
    ];

    for (const cred of credentials) {
      lines.push(`# User: ${cred.userId}`);
      lines.push(`user ${cred.mqttUsername}`);
      // Read own topics
      lines.push(`topic read ${this.statePrefix}/${cred.userId}/#`);
      // Write only to set topics
      lines.push(`topic write ${this.statePrefix}/${cred.userId}/+/set/#`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get all credentials for admin use
   */
  async getAllCredentials(): Promise<MqttCredentialDocument[]> {
    return this.mqttCredentialModel.find({ isActive: true }).exec();
  }
}
