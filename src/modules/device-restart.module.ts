import { Global, Module } from '@nestjs/common';
import { RedisConfig } from '../config/redis.config';
import { DeviceRestartService } from '../services/device-restart.service';

// Global so the user API (app + web) and the CMS controllers can both inject
// DeviceRestartService without re-importing this module. Device models come
// from the global DevicesModule.
@Global()
@Module({
  providers: [DeviceRestartService, RedisConfig],
  exports: [DeviceRestartService],
})
export class DeviceRestartModule {}
