import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { FirebaseUser } from '../strategies/firebase.strategy';
import {
  DeviceViewerService,
  parseViewPath,
} from '../../services/device-viewer.service';

/** request.user while reading a device shared read-only. */
export interface ViewingUser extends FirebaseUser {
  /** Set when request.user.uid is the OWNER's uid (read-only share). */
  viewOnly?: 'invite' | 'link';
  /** The signed-in viewer (invite mode). */
  viewerUid?: string;
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

function pathOf(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0];
}

@Injectable()
export class FirebaseAuthGuard extends AuthGuard('firebase') {
  constructor(@Optional() private readonly viewers?: DeviceViewerService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: ViewingUser }>();

    // Public view link: no account. Handlers see the owner's uid, but only
    // GET requests on that one device get through.
    const token = header(req, 'x-view-token');
    if (token && !req.headers.authorization) {
      const target = parseViewPath(req.method, pathOf(req), 'link');
      if (!target || !this.viewers) {
        throw new ForbiddenException('Link xem chỉ được phép xem thiết bị');
      }
      const link = await this.viewers.resolveLink(token);
      if (
        !link ||
        link.kind !== target.kind ||
        link.deviceId !== target.deviceId
      ) {
        throw new UnauthorizedException(
          'Link không tồn tại hoặc đã bị thu hồi',
        );
      }
      req.user = {
        uid: link.ownerUid,
        viewOnly: 'link',
      } as ViewingUser;
      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    // Invited viewer reading someone else's device: swap in the owner's uid
    // for this (GET-only) request after checking the share.
    const owner = header(req, 'x-view-owner');
    const user = req.user as FirebaseUser;
    if (owner && owner !== user.uid) {
      const target = parseViewPath(req.method, pathOf(req), 'invite');
      if (!target || !this.viewers) {
        throw new ForbiddenException('Bạn chỉ có quyền xem thiết bị này');
      }
      const granted = await this.viewers.hasGrant(
        user,
        owner,
        target.kind,
        target.deviceId,
      );
      if (!granted) {
        throw new ForbiddenException('Thiết bị không được chia sẻ với bạn');
      }
      req.user = {
        ...user,
        uid: owner,
        viewerUid: user.uid,
        viewOnly: 'invite',
      };
    }
    return true;
  }

  handleRequest<TUser = FirebaseUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      if (err instanceof Error) throw err;
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }
    return user;
  }
}
