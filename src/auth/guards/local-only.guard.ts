import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Only callers on this machine, reaching Nest directly (not through nginx).
 * Used for the mosquitto-go-auth hooks (validate / acl / superuser): the
 * plugin calls http://localhost:3000 on the same VPS. A request proxied by
 * nginx also comes from 127.0.0.1 but carries X-Forwarded-For / X-Real-IP,
 * so it is refused - these hooks must not be reachable from the internet.
 */
@Injectable()
export class LocalOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const remote = req.socket?.remoteAddress ?? '';
    const proxied =
      req.headers['x-forwarded-for'] !== undefined ||
      req.headers['x-real-ip'] !== undefined;
    if (LOOPBACK.has(remote) && !proxied) return true;
    throw new ForbiddenException();
  }
}
