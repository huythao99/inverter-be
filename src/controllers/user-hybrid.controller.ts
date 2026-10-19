import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { UpdateUserChargerSettingDto } from '../dto/update-user-charger-setting.dto';
import { SetGridTieDto } from '../dto/set-grid-tie.dto';
import {
  decodeChargerValue,
  encodeChargerValue,
} from '../utils/charger-value.util';
import {
  hybridGridTieApplied,
  hybridOutFor,
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

  @Get(':deviceId/settings')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const s = await this.settings.get(user.uid, deviceId);
    return { ...s, ...(decodeChargerValue(s.value) ?? {}) };
  }

  // { value: "HHHHLLLL" } or { vbat, ibat }.
  @Patch(':deviceId/settings')
  async updateSettings(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: UpdateUserChargerSettingDto,
    @Req() req: Request,
  ) {
    await this.assertOwned(user.uid, deviceId);
    let value: string;
    if (dto.value) value = dto.value;
    else if (dto.vbat !== undefined && dto.ibat !== undefined) {
      value = encodeChargerValue(dto.vbat, dto.ibat);
    } else {
      throw new BadRequestException(
        'Provide either "value" (HHHHLLLL) or both "vbat" and "ibat"',
      );
    }
    const s = await this.settings.setValue(
      user.uid,
      deviceId,
      value,
      this.ctx(req, user),
    );
    return { ...s, ...(decodeChargerValue(value) ?? {}) };
  }

  /**
   * Grid-tie ("hoà lưới") status. status: 1 = OFF, 0 = ON (same as the
   * inverter API). `out` = what the device should run (INV / BAT);
   * `applied` = whether the machine reports that OUT (null = no data yet).
   */
  @Get(':deviceId/grid-tie')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getGridTie(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const [s, d] = await Promise.all([
      this.settings.get(user.uid, deviceId),
      this.data.findLatest(user.uid, deviceId),
    ]);
    return this.gridTieView(deviceId, s.gridTieOff, d);
  }

  // { status: 1 } = tắt hoà lưới (OUT=BAT), { status: 0 } = bật (OUT=INV).
  @Patch(':deviceId/grid-tie')
  async setGridTie(
    @CurrentFirebaseUser() user: FirebaseUser,
    @Param('deviceId') deviceId: string,
    @Body() dto: SetGridTieDto,
    @Req() req: Request,
  ) {
    await this.assertOwned(user.uid, deviceId);
    const off = dto.status === 1;
    await this.settings.setGridTie(
      user.uid,
      deviceId,
      off,
      this.ctx(req, user),
    );
    const d = await this.data.findLatest(user.uid, deviceId);
    return this.gridTieView(deviceId, off, d);
  }

  private gridTieView(
    deviceId: string,
    off: boolean,
    d: { cfgOut?: string; out?: string } | null,
  ) {
    return {
      deviceId,
      status: off ? 1 : 0,
      gridTieOff: off,
      out: hybridOutFor(off),
      currentOut: d?.cfgOut || d?.out || null,
      applied: hybridGridTieApplied(off, d),
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
