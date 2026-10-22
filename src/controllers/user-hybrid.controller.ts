import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentFirebaseUser } from '../auth/decorators/firebase-user.decorator';
import { FirebaseUser } from '../auth/strategies/firebase.strategy';
import { auditCtx } from '../utils/audit-context';
import { HybridDeviceService } from '../services/hybrid-device.service';
import { HybridSettingService } from '../services/hybrid-setting.service';
import { HybridDataService } from '../services/hybrid-data.service';
import { HybridFirmwareService } from '../services/hybrid-firmware.service';
import { AuditLogService } from '../services/audit-log.service';
import {
  HYBRID_CONFIG_KEYS,
  HYBRID_READONLY_KEYS,
  hybridPendingKeys,
  vnDay,
} from '../constants/hybrid.constants';

// End-user (app/web) hybrid API. Auth: Firebase JWT, like /api/user/chargers.
@Controller('api/user/hybrids')
@UseGuards(FirebaseAuthGuard)
export class UserHybridController {
  constructor(
    private readonly devices: HybridDeviceService,
    private readonly settings: HybridSettingService,
    private readonly data: HybridDataService,
    private readonly firmware: HybridFirmwareService,
    private readonly audit: AuditLogService,
  ) {}

  private async assertOwned(userId: string, deviceId: string) {
    const device = await this.devices.findByUserIdAndDeviceId(userId, deviceId);
    if (!device) throw new NotFoundException(`Hybrid ${deviceId} not found`);
    return device;
  }

  private ctx(req: Request, user: FirebaseUser) {
    return auditCtx(req, { actor: user.uid, actorLabel: user.email ?? null });
  }

  @Get()
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async list(@CurrentFirebaseUser() user: FirebaseUser) {
    return { hybrids: await this.devices.findByUserId(user.uid) };
  }

  // One-time code passed to the device during setup (valid 30 min).
  @Post('claim')
  createClaim(@CurrentFirebaseUser() user: FirebaseUser) {
    return this.devices.createClaim(user.uid);
  }

  @Get('firmware/newest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  newestFirmware(@Query('deviceId') deviceId?: string) {
    return this.firmware.getNewestFirmwareVersion(deviceId);
  }

  @Get(':deviceId')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  get(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    return this.assertOwned(user.uid, deviceId);
  }

  @Patch(':deviceId')
  async update(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() body: { deviceName?: string; description?: string },
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.devices.update(user.uid, deviceId, body ?? {});
  }

  // Same as PATCH /:deviceId { description } (route kept for the app, which
  // calls /description like for chargers).
  @Patch(':deviceId/description')
  async updateDescription(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('description') description: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const device = await this.devices.update(user.uid, deviceId, {
      description: typeof description === 'string' ? description : '',
    });
    return { message: 'Description updated successfully', device };
  }

  @Delete(':deviceId')
  async remove(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    const removed = await this.devices.remove(user.uid, deviceId);
    if (!removed) throw new NotFoundException(`Hybrid ${deviceId} not found`);
    await Promise.all([
      this.data.removeDevice(user.uid, deviceId),
      this.settings.remove(user.uid, deviceId),
    ]).catch(() => {});
    return removed;
  }

  // Latest merged telemetry/config with online/offline status.
  @Get(':deviceId/data/latest')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async latest(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    return (
      (await this.data.findLatest(user.uid, deviceId)) ?? {
        userId: user.uid,
        deviceId,
        status: 'offline',
      }
    );
  }

  /**
   * Config view for the settings screen:
   * - config: keys the user set (server-owned, the device enforces them)
   * - cfg: the machine's latest $CFG (applied values + read-only keys)
   * - pending: config keys the machine doesn't run yet
   * - src: LOCAL = the machine refuses remote changes ("Cai dat tu = APP")
   * - lastNak: last refused SET / CMD { of, err, key?, at }
   */
  @Get(':deviceId/settings')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const [s, d] = await Promise.all([
      this.settings.get(user.uid, deviceId),
      this.data.findLatest(user.uid, deviceId),
    ]);
    return this.settingsView(s, d);
  }

  // Partial config: { MODE?, PCHG?, PEXP?, PIMP?, VEXP?, VCUT?, VRES?, PMAX?, PCMAX? }
  // (or the same under "config"). 400 { errors: [{ key, message }] } if invalid.
  @Patch(':deviceId/settings')
  async updateSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const input =
      body && typeof body.config === 'object' && body.config !== null
        ? (body.config as Record<string, unknown>)
        : (body ?? {});
    const d = await this.data.findLatest(user.uid, deviceId);
    const s = await this.settings.update(
      user.uid,
      deviceId,
      input,
      d?.cfg,
      this.ctx(req, user),
    );
    return this.settingsView(s, d);
  }

  private settingsView(
    s: Awaited<ReturnType<HybridSettingService['get']>>,
    d: Awaited<ReturnType<HybridDataService['findLatest']>>,
  ) {
    const cfg = d?.cfg ?? null;
    return {
      ...s,
      keys: HYBRID_CONFIG_KEYS,
      readonlyKeys: HYBRID_READONLY_KEYS,
      cfg,
      cfgAt: d?.cfgAt ?? null,
      src: cfg?.SRC ?? d?.tlm?.SRC ?? null,
      pending: hybridPendingKeys(s.config, cfg),
      lastNak: d?.lastNak ?? null,
      status: d?.status ?? 'offline',
    };
  }

  // { cmd: "FAULT_RST" | "STOP" | "RUN" } -> hybrid/{uid}/{dev}/cmd/action.
  @Post(':deviceId/command')
  @HttpCode(HttpStatus.OK)
  async command(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body('cmd') cmd: string,
    @Req() req: Request,
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.settings.command(user.uid, deviceId, cmd, this.ctx(req, user));
  }

  /**
   * Daily energy (Wh, VN days): ?from=YYYY-MM-DD&to=YYYY-MM-DD (default:
   * last 30 days). edis/echg = battery discharge/charge, eimp/eexp = grid
   * import/export.
   */
  @Get(':deviceId/energy')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async energy(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const today = vnDay();
    const end = to && re.test(to) ? to : today;
    const start =
      from && re.test(from)
        ? from
        : vnDay(new Date(Date.now() - 29 * 24 * 3600_000));
    if (start > end) throw new BadRequestException('from must be <= to');
    const days = await this.data.energy(user.uid, deviceId, start, end);
    const zero = { day: today, edis: 0, echg: 0, eimp: 0, eexp: 0 };
    return {
      from: start,
      to: end,
      today: days.find((x) => x.day === today) ?? zero,
      days,
    };
  }

  @Get(':deviceId/activity')
  async activity(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: number,
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.audit.list({
      userId: user.uid,
      deviceId,
      kind: 'hybrid',
      before,
      limit,
    });
  }

  @Get(':deviceId/firmware/version')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async firmwareVersion(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.assertOwned(user.uid, deviceId);
    return { firmwareVersion: device.firmwareVersion ?? null };
  }

  // Start an ESP32 OTA (progress on hybrid/{uid}/{dev}/ota/status).
  @Post(':deviceId/firmware/update')
  async updateFirmware(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.firmware.triggerFirmwareUpdate(user.uid, deviceId);
  }
}
