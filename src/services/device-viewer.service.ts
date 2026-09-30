import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  DeviceShareLink,
  DeviceShareLinkDocument,
  DeviceViewer,
  DeviceViewerDocument,
  ViewKind,
} from '../models/device-viewer.schema';
import {
  InverterDevice,
  InverterDeviceDocument,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceDocument,
} from '../models/charger-device.schema';

export const MAX_VIEWERS_PER_DEVICE = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CACHE_MS = 60_000;

/** Who may read, identified by the Firebase token. */
export interface ViewerIdentity {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export function isViewKind(v: string): v is ViewKind {
  return v === 'inverter' || v === 'charger';
}

const VIEW_PATH = /^\/api\/user\/(devices|chargers)\/([^/]+)(\/.*)?$/;
// Sub-resources a viewer never gets (firmware/OTA info, STM32 board info);
// a public link additionally hides the change history (who changed what).
const DENY_ALWAYS = ['firmware', 'stm'];
const DENY_FOR_LINK = ['activity'];
// Static routes that share the prefix but are not a device.
const NOT_A_DEVICE = ['firmware', 'claim'];

/**
 * Which device a read-only request targets, or null when a viewer may not make
 * it at all: only GET, only `/api/user/devices|chargers/<deviceId>[/...]`.
 */
export function parseViewPath(
  method: string,
  path: string,
  mode: 'invite' | 'link',
): { kind: ViewKind; deviceId: string } | null {
  if ((method || '').toUpperCase() !== 'GET') return null;
  const m = VIEW_PATH.exec(path || '');
  if (!m) return null;
  let deviceId: string;
  try {
    deviceId = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (NOT_A_DEVICE.includes(deviceId)) return null;
  const seg = (m[3] || '').split('/')[1] || '';
  if (DENY_ALWAYS.includes(seg)) return null;
  if (mode === 'link' && DENY_FOR_LINK.includes(seg)) return null;
  return { kind: m[1] === 'devices' ? 'inverter' : 'charger', deviceId };
}

@Injectable()
export class DeviceViewerService {
  private readonly linkCache = new Map<
    string,
    {
      at: number;
      v: { ownerUid: string; kind: ViewKind; deviceId: string } | null;
    }
  >();
  private readonly mqttCache = new Map<string, { at: number; v: string[] }>();

  constructor(
    @InjectModel(DeviceViewer.name)
    private readonly viewerModel: Model<DeviceViewerDocument>,
    @InjectModel(DeviceShareLink.name)
    private readonly linkModel: Model<DeviceShareLinkDocument>,
    @InjectModel(InverterDevice.name)
    private readonly inverterModel: Model<InverterDeviceDocument>,
    @InjectModel(ChargerDevice.name)
    private readonly chargerModel: Model<ChargerDeviceDocument>,
  ) {}

  private deviceModel(kind: ViewKind): Model<any> {
    return kind === 'inverter' ? this.inverterModel : this.chargerModel;
  }

  private async findDevice(ownerUid: string, kind: ViewKind, deviceId: string) {
    return this.deviceModel(kind)
      .findOne({ userId: ownerUid, deviceId })
      .select({ deviceName: 1, description: 1 })
      .lean<{ deviceName?: string; description?: string }>()
      .exec();
  }

  private async assertOwned(
    ownerUid: string,
    kind: ViewKind,
    deviceId: string,
  ) {
    const device = await this.findDevice(ownerUid, kind, deviceId);
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);
    return device;
  }

  private invalidate(): void {
    this.linkCache.clear();
    this.mqttCache.clear();
  }

  // ---- owner side ---------------------------------------------------------

  async listForOwner(ownerUid: string, kind: ViewKind, deviceId: string) {
    await this.assertOwned(ownerUid, kind, deviceId);
    const [viewers, link] = await Promise.all([
      this.viewerModel
        .find({ ownerUid, kind, deviceId })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.linkModel.findOne({ ownerUid, kind, deviceId }).lean().exec(),
    ]);
    return {
      viewers: viewers.map((v) => ({
        email: v.viewerEmail,
        joined: !!v.viewerUid,
        lastSeenAt: v.lastSeenAt ?? null,
        createdAt: v.createdAt ?? null,
      })),
      link: link
        ? { token: link.token, createdAt: link.createdAt ?? null }
        : null,
    };
  }

  async addViewer(
    owner: ViewerIdentity,
    kind: ViewKind,
    deviceId: string,
    rawEmail: string,
  ) {
    const email = String(rawEmail || '')
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      throw new BadRequestException('Email không hợp lệ');
    }
    if (owner.email && owner.email.toLowerCase() === email) {
      throw new BadRequestException('Không thể chia sẻ cho chính bạn');
    }
    await this.assertOwned(owner.uid, kind, deviceId);
    const count = await this.viewerModel.countDocuments({
      ownerUid: owner.uid,
      kind,
      deviceId,
    });
    if (count >= MAX_VIEWERS_PER_DEVICE) {
      throw new BadRequestException(
        `Tối đa ${MAX_VIEWERS_PER_DEVICE} người xem cho mỗi thiết bị`,
      );
    }
    await this.viewerModel.updateOne(
      { ownerUid: owner.uid, kind, deviceId, viewerEmail: email },
      { $setOnInsert: { viewerUid: null, lastSeenAt: null } },
      { upsert: true },
    );
    this.invalidate();
    return this.listForOwner(owner.uid, kind, deviceId);
  }

  async removeViewer(
    ownerUid: string,
    kind: ViewKind,
    deviceId: string,
    email: string,
  ) {
    await this.assertOwned(ownerUid, kind, deviceId);
    await this.viewerModel.deleteOne({
      ownerUid,
      kind,
      deviceId,
      viewerEmail: String(email || '')
        .trim()
        .toLowerCase(),
    });
    this.invalidate();
    return this.listForOwner(ownerUid, kind, deviceId);
  }

  /** Create (or replace: the old link stops working) the public view link. */
  async createLink(ownerUid: string, kind: ViewKind, deviceId: string) {
    await this.assertOwned(ownerUid, kind, deviceId);
    const token = crypto.randomBytes(24).toString('base64url');
    await this.linkModel.updateOne(
      { ownerUid, kind, deviceId },
      { $set: { token } },
      { upsert: true },
    );
    this.invalidate();
    return this.listForOwner(ownerUid, kind, deviceId);
  }

  async deleteLink(ownerUid: string, kind: ViewKind, deviceId: string) {
    await this.assertOwned(ownerUid, kind, deviceId);
    await this.linkModel.deleteOne({ ownerUid, kind, deviceId });
    this.invalidate();
    return this.listForOwner(ownerUid, kind, deviceId);
  }

  // ---- viewer side --------------------------------------------------------

  private verifiedEmail(user: ViewerIdentity): string | null {
    if (!user.email || !user.emailVerified) return null;
    return user.email.toLowerCase();
  }

  /** Devices shared with this account (also links the grants to its uid). */
  async sharedWithMe(user: ViewerIdentity) {
    const email = this.verifiedEmail(user);
    if (!email) {
      return { devices: [], emailNotVerified: !!user.email };
    }
    const grants = await this.viewerModel
      .find({ viewerEmail: email })
      .lean()
      .exec();
    if (grants.some((g) => g.viewerUid !== user.uid)) {
      await this.viewerModel.updateMany(
        { viewerEmail: email },
        { $set: { viewerUid: user.uid } },
      );
      this.mqttCache.delete(user.uid);
    }
    const devices: Array<{
      kind: ViewKind;
      deviceId: string;
      ownerUid: string;
      deviceName: string;
      description: string;
    }> = [];
    for (const g of grants) {
      if (g.ownerUid === user.uid) continue;
      const d = await this.findDevice(g.ownerUid, g.kind, g.deviceId);
      if (!d) continue; // owner removed the device
      devices.push({
        kind: g.kind,
        deviceId: g.deviceId,
        ownerUid: g.ownerUid,
        deviceName: d.deviceName || g.deviceId,
        description: d.description || '',
      });
    }
    return { devices, emailNotVerified: false };
  }

  /** Viewer stops seeing a device shared with them. */
  async leave(
    user: ViewerIdentity,
    ownerUid: string,
    kind: ViewKind,
    deviceId: string,
  ) {
    const email = this.verifiedEmail(user);
    if (!email) return { ok: true };
    await this.viewerModel.deleteOne({
      ownerUid,
      kind,
      deviceId,
      viewerEmail: email,
    });
    this.invalidate();
    return { ok: true };
  }

  async hasGrant(
    user: ViewerIdentity,
    ownerUid: string,
    kind: ViewKind,
    deviceId: string,
  ): Promise<boolean> {
    const email = this.verifiedEmail(user);
    if (!email) return false;
    const g = await this.viewerModel
      .findOneAndUpdate(
        { ownerUid, kind, deviceId, viewerEmail: email },
        { $set: { lastSeenAt: new Date(), viewerUid: user.uid } },
      )
      .lean()
      .exec();
    return !!g;
  }

  async resolveLink(token: string) {
    if (!token || token.length > 100) return null;
    const hit = this.linkCache.get(token);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const link = await this.linkModel.findOne({ token }).lean().exec();
    const v = link
      ? { ownerUid: link.ownerUid, kind: link.kind, deviceId: link.deviceId }
      : null;
    this.linkCache.set(token, { at: Date.now(), v });
    return v;
  }

  /** What an anonymous link visitor may learn: never the owner's uid. */
  async publicInfo(token: string) {
    const link = await this.resolveLink(token);
    if (!link)
      throw new NotFoundException('Link không tồn tại hoặc đã bị thu hồi');
    const d = await this.findDevice(link.ownerUid, link.kind, link.deviceId);
    if (!d) throw new NotFoundException('Thiết bị không còn tồn tại');
    return {
      kind: link.kind,
      deviceId: link.deviceId,
      deviceName: d.deviceName || link.deviceId,
      description: d.description || '',
    };
  }

  /** MQTT topic prefixes a viewer's app account may READ (shared devices). */
  async mqttPrefixesFor(viewerUid: string): Promise<string[]> {
    const hit = this.mqttCache.get(viewerUid);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
    const grants = await this.viewerModel.find({ viewerUid }).lean().exec();
    const v: string[] = [];
    for (const g of grants) {
      v.push(`${g.kind}/${g.ownerUid}/${g.deviceId}/`);
      v.push(`devices/${g.kind}/${g.ownerUid}/${g.deviceId}`);
    }
    this.mqttCache.set(viewerUid, { at: Date.now(), v });
    return v;
  }
}
