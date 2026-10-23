import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MqttAuthService } from '../../services/mqtt-auth.service';

/** Set on the request by HybridDeviceAuthGuard. */
export interface HybridDeviceAccount {
  userId: string;
  deviceId: string;
}

/**
 * Hybrid firmware calls: HTTP Basic auth with the device's own broker
 * account (hyb_<deviceId> + password from provisioning; TLS only).
 * The account must belong to the :deviceId (or ?deviceId=) of the route and,
 * when the route has :userId, to that owner.
 */
@Injectable()
export class HybridDeviceAuthGuard implements CanActivate {
  constructor(private readonly mqttAuth: MqttAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) {
      throw new UnauthorizedException('Device credentials required');
    }
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep <= 0) throw new UnauthorizedException('Bad credentials');
    const username = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);

    const acct = await this.mqttAuth.verifyDeviceCredentials(
      'hybrid',
      username,
      password,
    );
    if (!acct) throw new UnauthorizedException('Bad credentials');

    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const deviceId =
      params.deviceId ??
      (typeof query.deviceId === 'string' ? query.deviceId : undefined);
    if (!deviceId || deviceId !== acct.deviceId) {
      throw new ForbiddenException('Not this device');
    }
    if (params.userId !== undefined && params.userId !== acct.userId) {
      throw new ForbiddenException('Not this owner');
    }
    // For routes without :userId (e.g. ?deviceId=): the owner of the account.
    (req as Request & { hybridDevice?: HybridDeviceAccount }).hybridDevice = {
      userId: acct.userId,
      deviceId: acct.deviceId,
    };
    return true;
  }
}
