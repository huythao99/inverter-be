import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisConfig {
  constructor(private configService: ConfigService) {}

  createRedisClient(): Redis {
    const redisConfig = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      db: this.configService.get<number>('REDIS_DB', 0),
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
    } as any;

    // Only add password if it's provided
    const password = this.configService.get<string>('REDIS_PASSWORD');
    if (password) {
      redisConfig.password = password;
    }

    return new Redis(redisConfig);
  }
}
