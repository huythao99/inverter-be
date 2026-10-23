import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
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
import { EspFirmwareService } from '../services/esp-firmware.service';
import { StmFirmwareService } from '../services/stm-firmware.service';
import { BetaFirmwareDeviceService } from '../services/beta-firmware-device.service';
import { MqttService } from '../services/mqtt.service';
import { compareFirmwareVersions } from '../services/firmware.service';

/** Between two user-triggered ESP32 updates of the same device. */
const ESP_UPDATE_COOLDOWN_MS = 3 * 60 * 1000;
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
    private readonly espFirmware: EspFirmwareService,
    private readonly stm: StmFirmwareService,
    private readonly beta: BetaFirmwareDeviceService,
    private readonly mqtt: MqttService,
  ) {}

  private readonly espUpdateAt = new Map<string, number>();

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

  /**
   * "Cập nhật" tab: both chips with their version, the version offered
   * (stable, or beta for beta-list devices), whether an update is available
   * and the release notes up to the offered version, newest first.
   *   esp: ESP32 controller (OTA over WiFi, progress on .../ota/status)
   *   stm: STM32 power board (flashed by the ESP32, .../stm/ota/status)
   */
  @Get(':deviceId/firmware')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async firmwareOverview(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.assertOwned(user.uid, deviceId);
    const current = device.firmwareVersion ?? '';
    const target = this.firmware.getNewestFirmwareVersion(deviceId).version;
    const hasTarget = !!target && target !== '0.0.0';
    const espReleases = hasTarget
      ? await this.espFirmware.releaseNotes('hybrid', target).catch(() => [])
      : [];
    const stmInfo = await this.stm.describeByUserDevice(
      user.uid,
      deviceId,
      'hybrid',
    );
    const stmReleases = await this.stm
      .releases('hybrid', stmInfo, this.beta.isBeta(deviceId, user.uid))
      .catch(() => []);
    return {
      esp: {
        currentVersion: current || null,
        targetVersion: hasTarget ? target : null,
        updateAvailable:
          hasTarget &&
          !!current &&
          compareFirmwareVersions(current, target) < 0,
        releases: espReleases.map((r) => ({
          ...r,
          installed: r.version === current,
          isNew: !!current && compareFirmwareVersions(r.version, current) > 0,
        })),
      },
      stm: { ...stmInfo, releases: stmReleases },
    };
  }

  // Start an ESP32 OTA (progress on hybrid/{uid}/{dev}/ota/status). Only when
  // a newer build is offered; one request per device per 3 min.
  @Post(':deviceId/firmware/update')
  async updateFirmware(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    const device = await this.assertOwned(user.uid, deviceId);
    const current = device.firmwareVersion ?? '';
    const target = this.firmware.getNewestFirmwareVersion(deviceId).version;
    if (!target || target === '0.0.0') {
      throw new BadRequestException('Chưa có bản firmware cho thiết bị này');
    }
    if (current && compareFirmwareVersions(current, target) >= 0) {
      throw new BadRequestException(
        `Thiết bị đã ở phiên bản mới nhất (${current})`,
      );
    }
    if (!this.mqtt.isConnected()) {
      throw new HttpException(
        'Máy chủ MQTT đang mất kết nối, vui lòng thử lại sau',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const key = `${user.uid}/${deviceId}`;
    const now = Date.now();
    const last = this.espUpdateAt.get(key) ?? 0;
    if (now - last < ESP_UPDATE_COOLDOWN_MS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Đã gửi lệnh cập nhật, vui lòng chờ thiết bị cập nhật xong',
          retryAfterSeconds: Math.ceil(
            (ESP_UPDATE_COOLDOWN_MS - (now - last)) / 1000,
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (this.espUpdateAt.size > 1000) this.espUpdateAt.clear();
    this.espUpdateAt.set(key, now);
    const r = await this.firmware.triggerFirmwareUpdate(user.uid, deviceId);
    return {
      success: true,
      currentVersion: current || null,
      targetVersion: target,
      ...r,
    };
  }

  // STM32 power-board update (the device stops producing power ~40 s).
  @Post(':deviceId/stm/update')
  @HttpCode(HttpStatus.OK)
  async updateStm(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Headers('x-client') client?: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    return this.stm.trigger(user.uid, deviceId, {
      kind: 'hybrid',
      source: client === 'mobile' ? 'app' : 'web',
    });
  }
}
