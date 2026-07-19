import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TrackLogErrorService } from '../services/track-log-error.service';
import { CreateTrackLogErrorDto } from '../dto/create-track-log-error.dto';
import { QueryTrackLogErrorDto } from '../dto/query-track-log-error.dto';

@Controller('api/track-log-error')
export class TrackLogErrorController {
  constructor(private readonly trackLogErrorService: TrackLogErrorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTrackLogErrorDto) {
    await this.trackLogErrorService.create(dto);
    return { message: 'Error log saved' };
  }

  @Get()
  findAll(@Query() query: QueryTrackLogErrorDto) {
    return this.trackLogErrorService.findAll(query.page, query.limit);
  }

  @Get(':userId')
  findByUserId(
    @Param('userId') userId: string,
    @Query() query: QueryTrackLogErrorDto,
  ) {
    return this.trackLogErrorService.findByUserId(
      userId,
      query.page,
      query.limit,
    );
  }

  @Get(':userId/:deviceId')
  findByDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query() query: QueryTrackLogErrorDto,
  ) {
    return this.trackLogErrorService.findByUserIdAndDeviceId(
      userId,
      deviceId,
      query.page,
      query.limit,
    );
  }

  @Delete(':userId/:deviceId')
  deleteByDevice(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.trackLogErrorService.deleteByUserIdAndDeviceId(
      userId,
      deviceId,
    );
  }
}
