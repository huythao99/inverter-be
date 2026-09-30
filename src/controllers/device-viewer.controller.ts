import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import type { FirebaseUser } from '../auth/strategies/firebase.strategy';
import {
  DeviceViewerService,
  isViewKind,
} from '../services/device-viewer.service';
import type { ViewKind } from '../models/device-viewer.schema';
import { PublicStreamService } from '../services/public-stream.service';

const STREAM_PING_MS = 25_000; // keeps nginx/proxies from closing idle SSE
const STREAM_RECHECK_MS = 30_000; // a revoked/changed link stops streaming

function kindOf(v: string): ViewKind {
  if (!isViewKind(v))
    throw new BadRequestException('kind must be inverter|charger');
  return v;
}

/**
 * Read-only sharing of a device.
 * Owner:  manage viewers (by email) and the public link of one device.
 * Viewer: list devices shared with me, leave a share.
 * Reading a shared device goes through the normal GET endpoints with the
 * header `X-View-Owner: <ownerUid>` (see FirebaseAuthGuard).
 */
@Controller('api/user')
@UseGuards(FirebaseAuthGuard)
export class DeviceViewerController {
  constructor(private readonly viewers: DeviceViewerService) {}

  @Get('shared-with-me')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  sharedWithMe(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.viewers.sharedWithMe(user);
  }

  @Delete('shared-with-me/:ownerUid/:kind/:deviceId')
  leave(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('ownerUid') ownerUid: string,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.viewers.leave(user, ownerUid, kindOf(kind), deviceId);
  }

  @Get('viewers/:kind/:deviceId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  list(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.viewers.listForOwner(user.uid, kindOf(kind), deviceId);
  }

  @Post('viewers/:kind/:deviceId')
  add(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
    @Body() body: { email?: string },
  ) {
    return this.viewers.addViewer(
      user,
      kindOf(kind),
      deviceId,
      body?.email ?? '',
    );
  }

  // Declared before ':email' so "link" is never taken for an email.
  @Post('viewers/:kind/:deviceId/link')
  createLink(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.viewers.createLink(user.uid, kindOf(kind), deviceId);
  }

  @Delete('viewers/:kind/:deviceId/link')
  deleteLink(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.viewers.deleteLink(user.uid, kindOf(kind), deviceId);
  }

  @Delete('viewers/:kind/:deviceId/:email')
  remove(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('kind') kind: string,
    @Param('deviceId') deviceId: string,
    @Param('email') email: string,
  ) {
    return this.viewers.removeViewer(user.uid, kindOf(kind), deviceId, email);
  }
}

/**
 * Anonymous entry point of a public view link. The data itself is read from
 * the normal GET endpoints with the header `X-View-Token: <token>`.
 */
@Controller('api/public/view')
// Global short/medium/long per-IP limits apply (token guessing).
@UseGuards(ThrottlerGuard)
export class PublicViewController {
  constructor(
    private readonly viewers: DeviceViewerService,
    private readonly streams: PublicStreamService,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  info(@Param('token') token: string) {
    return this.viewers.publicInfo(token);
  }

  /**
   * Live data of the linked device as Server-Sent Events:
   *   event: data | status   data: {"payload": "<raw MQTT payload>", "at": ms}
   *   event: revoked         (link deleted/changed: the stream ends)
   * Relayed by the server, so the visitor needs no broker account and never
   * sees the owner's uid (it is part of the MQTT topics).
   */
  @Get(':token/stream')
  async stream(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const link = await this.viewers.resolveLink(token);
    if (!link)
      throw new NotFoundException('Link không tồn tại hoặc đã bị thu hồi');
    const key = `${link.kind}/${link.ownerUid}/${link.deviceId}`;
    if (!this.streams.acquire(key)) {
      throw new HttpException(
        'Quá nhiều người đang xem, vui lòng thử lại sau',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: the global compression middleware leaves it alone
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: don't buffer
    });
    const write = (chunk: string) => {
      res.write(chunk);
      (res as unknown as { flush?: () => void }).flush?.();
    };
    const send = (event: string, data: unknown) =>
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('retry: 5000\n\n');

    const base = `${key}/`;
    const stop = this.streams.listen(
      [`${base}data`, `${base}status`],
      (topic, payload) =>
        send(topic.endsWith('/status') ? 'status' : 'data', {
          payload,
          at: Date.now(),
        }),
    );

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      stop();
      clearInterval(ping);
      clearInterval(recheck);
      this.streams.release(key);
    };
    const ping = setInterval(() => write(': ping\n\n'), STREAM_PING_MS);
    const recheck = setInterval(() => {
      this.viewers
        .resolveLink(token)
        .catch(() => null)
        .then((now) => {
          if (
            !now ||
            now.ownerUid !== link.ownerUid ||
            now.kind !== link.kind ||
            now.deviceId !== link.deviceId
          ) {
            send('revoked', {});
            cleanup();
            res.end();
          }
        })
        .catch(() => undefined);
    }, STREAM_RECHECK_MS);
    req.on('close', cleanup);
  }
}
