import { LocalOnlyGuard } from '../auth/guards/local-only.guard';
import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  HttpException,
  GoneException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { MqttAuthService } from '../services/mqtt-auth.service';

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

  constructor(private readonly mqttAuthService: MqttAuthService) {}

  // These two routes had no authentication (anyone could read or reset a
  // user's Home Assistant password from a uid). Replaced by the signed-in
  // api/user/hass endpoints.
  @Get('config/:userId')
  getConfig() {
    throw new GoneException('Use /api/user/hass');
  }

  @Post('regenerate/:userId')
  regeneratePassword() {
    throw new GoneException('Use /api/user/hass');
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
  // Local mosquitto only (LocalOnlyGuard). No rate limit: every client of the
  // broker (hundreds of devices + users after a broker restart) authenticates
  // through here; go-auth caches the results.
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalOnlyGuard)
  async validateCredentials(@Body() body: ValidateRequestDto) {
    const { username, password } = body;

    if (!username || !password) {
      this.logger.debug('Validate: missing username or password');
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const isValid = await this.mqttAuthService.validateCredentials(
      username,
      password,
    );

    if (isValid) {
      return { ok: true };
    }

    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
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
  @UseGuards(LocalOnlyGuard)
  async checkAcl(@Body() body: AclRequestDto) {
    const { username, topic, acc } = body;

    if (!username || !topic) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
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
      return { ok: true };
    }

    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }

  /**
   * Check if user is superuser (called by Mosquitto auth plugin)
   * POST /api/mqtt-auth/superuser
   *
   * Superusers bypass ACL checks entirely - can read/write all topics.
   *
   * Response: HTTP 200 = is superuser, HTTP 403 = not superuser
   */
  @Post('superuser')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalOnlyGuard)
  async checkSuperuser(@Body() body: { username: string }) {
    const { username } = body;

    // Check if user is superuser via service
    const isSuperuser = await this.mqttAuthService.isSuperuser(username);

    if (isSuperuser) {
      return { ok: true };
    }

    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
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
}
