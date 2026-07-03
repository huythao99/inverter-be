import { CacheInterceptor } from '@nestjs/cache-manager';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

/**
 * Same 30s cache as CacheInterceptor for normal/app calls, but skips caching
 * for ESP32 calls (`?source=hardware`) because the returned setting value is
 * dynamic (depends on live share telemetry) and must not be served stale.
 */
@Injectable()
export class SettingCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.query?.source === 'hardware') {
      return undefined; // undefined => do not cache this request
    }
    return super.trackBy(context);
  }
}
