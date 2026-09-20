import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  ChargerData,
  ChargerDataDocument,
} from '../models/charger-data.schema';

// A device is considered offline if no message arrives within this window.
const OFFLINE_THRESHOLD_MS = 15000;

export interface ChargerDataEventPayload {
  userId: string;
  deviceId: string;
  data: Record<string, any>; // parsed STM32 frame from the `data` topic
}

export interface ChargerStatusEventPayload {
  userId: string;
  deviceId: string;
  status: string; // "online"
}

@Injectable()
export class ChargerDataService {
  constructor(
    @InjectModel(ChargerData.name)
    private chargerDataModel: Model<ChargerDataDocument>,
  ) {}

  private withDerivedStatus(doc: ChargerData | null): ChargerData | null {
    if (!doc) return doc;
    const lastSeen = doc.lastSeenAt ? new Date(doc.lastSeenAt).getTime() : 0;
    const online = Date.now() - lastSeen < OFFLINE_THRESHOLD_MS;
    return { ...doc, status: online ? 'online' : 'offline' };
  }

  async findLatestByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<ChargerData | null> {
    const doc = await this.chargerDataModel
      .findOne({ userId, deviceId })
      .select('-__v')
      .lean()
      .exec();
    return this.withDerivedStatus(doc as ChargerData | null);
  }

  async findAll(
    page: number = 1,
    limit: number = 100,
  ): Promise<{
    data: ChargerData[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.chargerDataModel
        .find()
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .lean()
        .exec(),
      this.chargerDataModel.countDocuments().exec(),
    ]);

    return {
      data: (data as ChargerData[]).map((d) => this.withDerivedStatus(d)!),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteAll(): Promise<{ deletedCount: number }> {
    const result = await this.chargerDataModel.deleteMany({}).exec();
    return { deletedCount: result.deletedCount };
  }

  // Map the parsed frame's uppercase keys to the schema fields, keyed by the
  // frame `type` (TLM/CFG/INFO). Only fields present in the message are written.
  private mapPayload(data: Record<string, any>): Partial<ChargerData> {
    const type = String(data.type ?? '').toUpperCase();
    const update: Partial<ChargerData> = {
      lastType: type ? type.toLowerCase() : undefined,
    };

    const s = (v: unknown): string | undefined => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return undefined;
    };

    if (type === 'TLM') {
      update.st = s(data.ST);
      update.flt = s(data.FLT);
      update.lock = s(data.LOCK);
      update.rtry = s(data.RTRY);
      update.out = s(data.OUT);
      update.temp = s(data.T);
      update.mode = s(data.MODE);
      update.ms = s(data.MS);
      update.vpv = s(data.VPV);
      update.ipv = s(data.IPV);
      update.ppv = s(data.PPV);
      update.vbat = s(data.VBAT);
      update.ibat = s(data.IBAT);
      update.il = s(data.IL);
      update.duty = s(data.DUTY);
      update.vref = s(data.VREF);
      update.dev = s(data.DEV) ?? update.dev;
    } else if (type === 'CFG') {
      update.cfgVbat = s(data.VBAT);
      update.cfgIbat = s(data.IBAT);
      update.cfgPbat = s(data.PBAT);
      update.cfgOut = s(data.OUT);
      update.src = s(data.SRC);
    } else if (type === 'INFO') {
      update.dev = s(data.DEV);
      update.proto = s(data.PROTO);
      update.fw = s(data.FW);
      update.hw = s(data.HW);
    }

    if (data.raw !== undefined) update.raw = s(data.raw);

    // Drop undefined keys so upsert doesn't overwrite existing values with null.
    Object.keys(update).forEach((k) => {
      if ((update as Record<string, unknown>)[k] === undefined) {
        delete (update as Record<string, unknown>)[k];
      }
    });

    return update;
  }

  @OnEvent('charger.data.received')
  handleChargerDataReceived(payload: ChargerDataEventPayload): void {
    const update = this.mapPayload(payload.data ?? {});
    const now = new Date();

    this.chargerDataModel
      .findOneAndUpdate(
        { userId: payload.userId, deviceId: payload.deviceId },
        {
          $set: {
            ...update,
            userId: payload.userId,
            deviceId: payload.deviceId,
            status: 'online',
            lastSeenAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      )
      .exec()
      .catch(() => {});
  }

  @OnEvent('charger.status.received')
  handleChargerStatusReceived(payload: ChargerStatusEventPayload): void {
    const now = new Date();
    this.chargerDataModel
      .findOneAndUpdate(
        { userId: payload.userId, deviceId: payload.deviceId },
        {
          $set: {
            userId: payload.userId,
            deviceId: payload.deviceId,
            status: payload.status || 'online',
            lastSeenAt: now,
          },
        },
        { upsert: true },
      )
      .exec()
      .catch(() => {});
  }
}
