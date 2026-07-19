import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TrackLogError,
  TrackLogErrorDocument,
} from '../models/track-log-error.schema';
import { CreateTrackLogErrorDto } from '../dto/create-track-log-error.dto';

@Injectable()
export class TrackLogErrorService {
  constructor(
    @InjectModel(TrackLogError.name)
    private trackLogErrorModel: Model<TrackLogErrorDocument>,
  ) {}

  async create(dto: CreateTrackLogErrorDto): Promise<TrackLogError> {
    const created = new this.trackLogErrorModel(dto);
    return created.save();
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
