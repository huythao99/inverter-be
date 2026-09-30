/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  INestApplication,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import * as request from 'supertest';
import { FirebaseAuthGuard } from './auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from './auth/decorators/firebase-user.decorator';
import { DeviceViewerService } from './services/device-viewer.service';

// Fake "firebase" strategy: Bearer <uid>[:verified-email]
class FakeFirebase extends PassportStrategy(Strategy, 'firebase') {
  validate(req: any) {
    const h: string = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new UnauthorizedException('no token');
    const [uid, email] = h.slice(7).split(':');
    return { uid, email, emailVerified: !!email };
  }
}

@Controller('api/user')
@UseGuards(FirebaseAuthGuard)
class DummyController {
  @Get('devices/:id/data/latest')
  latest(@CurrentFirebaseUser() u: any) {
    return { uid: u.uid, viewOnly: u.viewOnly ?? null };
  }
  @Patch('devices/:id/settings')
  write(@CurrentFirebaseUser() u: any) {
    return { wrote: u.uid };
  }
  @Get('mqtt-credentials')
  creds(@CurrentFirebaseUser() u: any) {
    return { uid: u.uid };
  }
}

describe('FirebaseAuthGuard read-only sharing', () => {
  let app: INestApplication;
  const viewers = {
    hasGrant: jest.fn(
      async (u: any, owner: string, kind: string, dev: string) =>
        u.email === 'friend@x.com' &&
        owner === 'OWNER' &&
        kind === 'inverter' &&
        dev === 'GTI1',
    ),
    resolveLink: jest.fn(async (t: string) =>
      t === 'TOKEN'
        ? { ownerUid: 'OWNER', kind: 'inverter', deviceId: 'GTI1' }
        : null,
    ),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'firebase' })],
      controllers: [DummyController],
      providers: [
        FakeFirebase,
        { provide: DeviceViewerService, useValue: viewers },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const srv = () => request(app.getHttpServer());

  it('owner reads normally', async () => {
    const r = await srv()
      .get('/api/user/devices/GTI1/data/latest')
      .set('Authorization', 'Bearer OWNER');
    expect(r.body).toEqual({ uid: 'OWNER', viewOnly: null });
  });
  it('invited viewer reads as owner, only GET', async () => {
    const r = await srv()
      .get('/api/user/devices/GTI1/data/latest')
      .set('Authorization', 'Bearer FRIEND:friend@x.com')
      .set('X-View-Owner', 'OWNER');
    expect(r.body).toEqual({ uid: 'OWNER', viewOnly: 'invite' });
    const w = await srv()
      .patch('/api/user/devices/GTI1/settings')
      .set('Authorization', 'Bearer FRIEND:friend@x.com')
      .set('X-View-Owner', 'OWNER');
    expect(w.status).toBe(403);
  });
  it('viewer without a grant or on another device is refused', async () => {
    const r1 = await srv()
      .get('/api/user/devices/GTI2/data/latest')
      .set('Authorization', 'Bearer FRIEND:friend@x.com')
      .set('X-View-Owner', 'OWNER');
    expect(r1.status).toBe(403);
    const r2 = await srv()
      .get('/api/user/devices/GTI1/data/latest')
      .set('Authorization', 'Bearer EVIL:evil@x.com')
      .set('X-View-Owner', 'OWNER');
    expect(r2.status).toBe(403);
    const r3 = await srv()
      .get('/api/user/mqtt-credentials')
      .set('Authorization', 'Bearer FRIEND:friend@x.com')
      .set('X-View-Owner', 'OWNER');
    expect(r3.status).toBe(403);
  });
  it('public link: GET of that device only, no account', async () => {
    const r = await srv()
      .get('/api/user/devices/GTI1/data/latest')
      .set('X-View-Token', 'TOKEN');
    expect(r.body).toEqual({ uid: 'OWNER', viewOnly: 'link' });
    expect(
      (
        await srv()
          .get('/api/user/devices/GTI9/data/latest')
          .set('X-View-Token', 'TOKEN')
      ).status,
    ).toBe(401);
    expect(
      (
        await srv()
          .get('/api/user/devices/GTI1/data/latest')
          .set('X-View-Token', 'BAD')
      ).status,
    ).toBe(401);
    expect(
      (
        await srv()
          .patch('/api/user/devices/GTI1/settings')
          .set('X-View-Token', 'TOKEN')
      ).status,
    ).toBe(403);
    expect(
      (
        await srv()
          .get('/api/user/mqtt-credentials')
          .set('X-View-Token', 'TOKEN')
      ).status,
    ).toBe(403);
  });
  it('no auth at all is 401', async () => {
    expect((await srv().get('/api/user/devices/GTI1/data/latest')).status).toBe(
      401,
    );
  });
});
