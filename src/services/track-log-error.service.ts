import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  TRACK_LOG_TTL_SECONDS,
  TrackLogError,
  TrackLogErrorDocument,
} from '../models/track-log-error.schema';
import { CreateTrackLogErrorDto } from '../dto/create-track-log-error.dto';

@Injectable()
export class TrackLogErrorService implements OnModuleInit {
  private readonly logger = new Logger(TrackLogErrorService.name);

  constructor(
    @InjectModel(TrackLogError.name)
    private trackLogErrorModel: Model<TrackLogErrorDocument>,
    private eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.migrateIndexes();
  }

  /**
   * One-off index migration for existing databases (autoIndex only creates
   * indexes, it never drops or changes them):
   *  - drop the old {createdAt: -1} and redundant {userId: 1} indexes
   *  - make sure the {createdAt: 1} index carries the current TTL
   */
  private async migrateIndexes(): Promise<void> {
    const coll = this.trackLogErrorModel.collection;
    try {
      const indexes = await coll.indexes();
      for (const name of ['createdAt_-1', 'userId_1']) {
        if (indexes.some((i) => i.name === name)) {
          await coll.dropIndex(name);
          this.logger.log(`Dropped index tracklogerrors.${name}`);
        }
      }
      const ttl = indexes.find((i) => i.name === 'createdAt_1');
      if (ttl && ttl.expireAfterSeconds !== TRACK_LOG_TTL_SECONDS) {
        await this.trackLogErrorModel.db.db?.command({
          collMod: coll.collectionName,
          index: {
            keyPattern: { createdAt: 1 },
            expireAfterSeconds: TRACK_LOG_TTL_SECONDS,
          },
        });
        this.logger.log('Updated TTL on tracklogerrors.createdAt_1');
      } else if (!ttl) {
        await coll.createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: TRACK_LOG_TTL_SECONDS, background: true },
        );
        this.logger.log('Created TTL index tracklogerrors.createdAt_1');
      }
    } catch (err) {
      this.logger.warn(
        `tracklogerrors index migration failed: ${(err as Error).message}`,
      );
    }
  }

  async create(dto: CreateTrackLogErrorDto): Promise<TrackLogError> {
    const created = new this.trackLogErrorModel(dto);
    const saved = await created.save();
    // Feeds the CMS device-health page (DeviceHealthService).
    this.eventEmitter.emit('device.log.created', {
      userId: dto.userId,
      deviceId: dto.deviceId,
      errorCode: dto.errorCode,
      errorMessage: dto.errorMessage,
    });
    return saved;
  }

  async findAll(
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TrackLogError[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const result = await this.trackLogErrorModel
      .aggregate<{ data: TrackLogError[]; totalCount: [{ count: number }] }>([
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { __v: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TrackLogError[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const result = await this.trackLogErrorModel
      .aggregate<{ data: TrackLogError[]; totalCount: [{ count: number }] }>([
        { $match: { userId, deviceId } },
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { __v: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async findByUserId(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: TrackLogError[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const result = await this.trackLogErrorModel
      .aggregate<{ data: TrackLogError[]; totalCount: [{ count: number }] }>([
        { $match: { userId } },
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: { __v: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const data = result[0]?.data || [];
    const total = result[0]?.totalCount[0]?.count || 0;
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  async deleteByUserIdAndDeviceId(
    userId: string,
    deviceId: string,
  ): Promise<{ deletedCount: number }> {
    const result = await this.trackLogErrorModel
      .deleteMany({ userId, deviceId })
      .exec();
    return { deletedCount: result.deletedCount };
  }
}
