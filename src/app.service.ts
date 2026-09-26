import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { MqttService } from './services/mqtt.service';
import { InverterDeviceService } from './services/inverter-device.service';
import { renderLanding } from './landing/landing.page';

/** Backend version, shown on the landing page and by GET /version. */
export const BACKEND_VERSION = '0.2.27';

const DEFAULT_PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.bms.gti_control';
// Device count changes slowly; don't hit the DB on every page view.
const COUNT_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private deviceCount = 0;
  private deviceCountAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly mqttService: MqttService,
    private readonly inverterDeviceService: InverterDeviceService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async getDeviceCount(): Promise<number> {
    if (Date.now() - this.deviceCountAt < COUNT_TTL_MS) return this.deviceCount;
    try {
      this.deviceCount =
        await this.inverterDeviceService.countDistinctDevices();
      this.deviceCountAt = Date.now();
    } catch (err) {
      this.logger.warn(
        `Landing device count failed: ${(err as Error).message}`,
      );
    }
    return this.deviceCount;
  }

  // Only https URLs from the environment end up in the page.
  private storeUrl(key: string, fallback: string | null): string | null {
    const url = this.config.get<string>(key) || fallback;
    return url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
  }

  async getLandingPage(): Promise<string> {
    return renderLanding({
      healthy:
        this.mqttService.isConnected() &&
        this.connection.readyState === ConnectionStates.connected,
      deviceCount: await this.getDeviceCount(),
      version: BACKEND_VERSION,
      year: new Date().getFullYear(),
      playStoreUrl: this.storeUrl('APP_STORE_URL_ANDROID', DEFAULT_PLAY_URL),
      appStoreUrl: this.storeUrl('APP_STORE_URL_IOS', null),
    });
  }
}
