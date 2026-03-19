import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MqttAuthService } from '../services/mqtt-auth.service';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';

interface ValidateRequestDto {
  username: string;
  password: string;
}

interface AclRequestDto {
  username: string;
  topic: string;
  acc: number; // 1 = read, 2 = write, 3 = subscribe
}

@Controller('api/mqtt-auth')
export class MqttAuthController {
  private readonly logger = new Logger(MqttAuthController.name);

  constructor(
    private readonly mqttAuthService: MqttAuthService,
    @InjectModel(InverterDevice.name)
    private inverterDeviceModel: Model<InverterDeviceDocument>,
  ) {}

  /**
   * Get MQTT configuration for Home Assistant
   * GET /api/mqtt-auth/config/:userId
   */
  @Get('config/:userId')
  async getConfig(@Param('userId') userId: string) {
    // Get user's devices
    const devices = await this.inverterDeviceModel
      .find({ userId })
      .select('deviceId deviceName')
      .lean()
      .exec();

    const deviceList = devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
    }));

    const config = await this.mqttAuthService.getHAConfig(userId, deviceList);

    if (!config) {
      return {
        success: false,
        error: 'Failed to generate MQTT configuration',
      };
    }

    return {
      success: true,
      data: {
        ...config,
        setupInstructions: {
          step1: 'Open Home Assistant',
          step2: 'Go to Settings → Devices & Services',
          step3: 'Click "Add Integration" and search for "MQTT"',
          step4: 'Enter the broker, port, username, and password below',
          step5: 'Your inverter devices will appear automatically!',
        },
      },
    };
  }

  /**
   * Regenerate MQTT password
   * POST /api/mqtt-auth/regenerate/:userId
   */
  @Post('regenerate/:userId')
  async regeneratePassword(@Param('userId') userId: string) {
    const credential = await this.mqttAuthService.regeneratePassword(userId);

    if (!credential) {
      return {
        success: false,
        error: 'Failed to regenerate password',
      };
    }

    // Get updated config
    const devices = await this.inverterDeviceModel
      .find({ userId })
      .select('deviceId deviceName')
      .lean()
      .exec();

    const deviceList = devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
    }));

    const config = await this.mqttAuthService.getHAConfig(userId, deviceList);

    return {
      success: true,
      message: 'Password regenerated successfully. Please update Home Assistant with the new credentials.',
      data: config,
    };
  }

  /**
   * Revoke MQTT access
   * DELETE /api/mqtt-auth/revoke/:userId
   */
  @Delete('revoke/:userId')
  async revokeAccess(@Param('userId') userId: string) {
    await this.mqttAuthService.revokeAccess(userId);

    return {
      success: true,
      message: 'MQTT access revoked successfully',
    };
  }

  /**
   * Validate MQTT credentials (called by Mosquitto auth plugin)
   * POST /api/mqtt-auth/validate
   *
   * Mosquitto HTTP auth plugin sends:
   * - username: MQTT username
   * - password: MQTT password
   *
   * Response: HTTP 200 = allow, HTTP 403 = deny
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateCredentials(@Body() body: ValidateRequestDto) {
    const { username, password } = body;

    if (!username || !password) {
      this.logger.debug('Validate: missing username or password');
      return { result: 'deny' };
    }

    const isValid = await this.mqttAuthService.validateCredentials(
      username,
      password,
    );

    if (isValid) {
      return { result: 'allow' };
    }

    return { result: 'deny' };
  }

  /**
   * Check ACL (called by Mosquitto auth plugin)
   * POST /api/mqtt-auth/acl
   *
   * Mosquitto HTTP auth plugin sends:
   * - username: MQTT username
   * - topic: MQTT topic
   * - acc: access type (1=read, 2=write, 3=subscribe)
   *
   * Response: HTTP 200 = allow, HTTP 403 = deny
   */
  @Post('acl')
  @HttpCode(HttpStatus.OK)
  async checkAcl(@Body() body: AclRequestDto) {
    const { username, topic, acc } = body;

    if (!username || !topic) {
      return { result: 'deny' };
    }

    // Convert acc number to access type
    let access: 'read' | 'write' | 'subscribe';
    switch (acc) {
      case 1:
        access = 'read';
        break;
      case 2:
        access = 'write';
        break;
      case 3:
      case 4:
        access = 'subscribe';
        break;
      default:
        access = 'read';
    }

    const isAllowed = await this.mqttAuthService.checkAcl(
      username,
      topic,
      access,
    );

    if (isAllowed) {
      return { result: 'allow' };
    }

    return { result: 'deny' };
  }

  /**
   * Health check endpoint for Mosquitto auth plugin
   * GET /api/mqtt-auth/health
   */
  @Get('health')
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get credential status for a user (admin use)
   * GET /api/mqtt-auth/status/:userId
   */
  @Get('status/:userId')
  async getStatus(@Param('userId') userId: string) {
    const credential =
      await this.mqttAuthService.getCredentialByUserId(userId);

    if (!credential) {
      return {
        success: true,
        data: {
          hasCredentials: false,
          isActive: false,
        },
      };
    }

    return {
      success: true,
      data: {
        hasCredentials: true,
        isActive: credential.isActive,
        mqttUsername: credential.mqttUsername,
        allowedDevices: credential.allowedDevices,
        lastUsedAt: credential.lastUsedAt,
        createdAt: credential.createdAt,
      },
    };
  }

  /**
   * Generate Mosquitto password file content
   * GET /api/mqtt-auth/files/passwd
   *
   * Download this and save to /etc/mosquitto/passwd
   * Then run: mosquitto_passwd -U /etc/mosquitto/passwd
   */
  @Get('files/passwd')
  async getPasswordFile() {
    const content = await this.mqttAuthService.generatePasswordFileContent();
    return {
      success: true,
      filename: 'passwd',
      content,
      instructions: [
        '1. Save this content to /etc/mosquitto/passwd',
        '2. Run: sudo mosquitto_passwd -U /etc/mosquitto/passwd',
        '3. Run: sudo systemctl reload mosquitto',
      ],
    };
  }

  /**
   * Generate Mosquitto ACL file content
   * GET /api/mqtt-auth/files/acl
   *
   * Download this and save to /etc/mosquitto/acl.conf
   */
  @Get('files/acl')
  async getAclFile() {
    const content = await this.mqttAuthService.generateAclFileContent();
    return {
      success: true,
      filename: 'acl.conf',
      content,
      instructions: [
        '1. Save this content to /etc/mosquitto/acl.conf',
        '2. Run: sudo systemctl reload mosquitto',
      ],
    };
  }

  /**
   * Get all files needed for Mosquitto setup
   * GET /api/mqtt-auth/files
   */
  @Get('files')
  async getAllFiles() {
    const [passwd, acl] = await Promise.all([
      this.mqttAuthService.generatePasswordFileContent(),
      this.mqttAuthService.generateAclFileContent(),
    ]);

    const credentials = await this.mqttAuthService.getAllCredentials();

    return {
      success: true,
      data: {
        passwd: {
          filename: '/etc/mosquitto/passwd',
          content: passwd,
        },
        acl: {
          filename: '/etc/mosquitto/acl.conf',
          content: acl,
        },
        usersCount: credentials.length,
      },
      instructions: [
        '1. Save passwd content to /etc/mosquitto/passwd',
        '2. Run: sudo mosquitto_passwd -U /etc/mosquitto/passwd',
        '3. Save acl content to /etc/mosquitto/acl.conf',
        '4. Add to mosquitto.conf:',
        '   password_file /etc/mosquitto/passwd',
        '   acl_file /etc/mosquitto/acl.conf',
        '5. Run: sudo systemctl restart mosquitto',
      ],
    };
  }
}
