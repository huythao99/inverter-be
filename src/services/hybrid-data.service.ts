import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { HybridData, HybridDataDocument } from '../models/hybrid-data.schema';
import {
  ChargerDataEventPayload,
  ChargerStatusEventPayload,
  mapMpptFrame,
} from './charger-data.service';

// Offline when no message arrived within this window (same as the charger).
const OFFLINE_THRESHOLD_MS = 15000;

/** Latest merged state of each hybrid, from hybrid/{uid}/{dev}/(data|status). */
@Injectable()
export class HybridDataService {
  constructor(
    @InjectModel(HybridData.name)
    private readonly model: Model<HybridDataDocument>,
  ) {}

  async findLatest(
    userId: string,
    deviceId: string,
  ): Promise<HybridData | null> {
    const doc = (await this.model
      .findOne({ userId, deviceId })
      .select('-__v')
      .lean()
      .exec()) as HybridData | null;
    if (!doc) return null;
    const lastSeen = doc.lastSeenAt ? new Date(doc.lastSeenAt).getTime() : 0;
    const online = Date.now() - lastSeen < OFFLINE_THRESHOLD_MS;
    return { ...doc, status: online ? 'online' : 'offline' };
  }

  @OnEvent('hybrid.data.received')
  onData(payload: ChargerDataEventPayload): void {
    const update = mapMpptFrame(payload.data ?? {});
    const now = new Date();
    this.model
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

  @OnEvent('hybrid.status.received')
  onStatus(payload: ChargerStatusEventPayload): void {
    const now = new Date();
    this.model
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
