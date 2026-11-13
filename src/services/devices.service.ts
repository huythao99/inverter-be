import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Device, DeviceDocument, DeviceKind } from '../models/device.schema';

/** Lookups across device types (the "devices" collection, by `kind`). */
@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name) private readonly devices: Model<DeviceDocument>,
  ) {}

  /** Entries of this id (one per owner), with their kind. */
  async owners(
    deviceId: string,
  ): Promise<{ userId: string; kind: DeviceKind }[]> {
    const rows = await this.devices
      .find({ deviceId }, { userId: 1, kind: 1, _id: 0 })
      .lean<{ userId: string; kind: DeviceKind }[]>()
      .exec();
    return rows;
  }

  /** Kind of a device id (any owner), null if no one has it. */
  async kindOf(deviceId: string, userId?: string): Promise<DeviceKind | null> {
    const row = await this.devices
      .findOne(userId ? { userId, deviceId } : { deviceId }, { kind: 1 })
      .lean<{ kind: DeviceKind }>()
      .exec();
    return row?.kind ?? null;
  }

  /** Every device of a user, all kinds. */
  listByUser(userId: string) {
    return this.devices
      .find({ userId })
      .sort({ kind: 1, deviceId: 1 })
      .lean<Device[]>()
      .exec();
  }
}
