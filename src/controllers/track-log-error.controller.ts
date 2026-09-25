import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TrackLogErrorService } from '../services/track-log-error.service';
import { CreateTrackLogErrorDto } from '../dto/create-track-log-error.dto';

@Controller('api/track-log-error')
export class TrackLogErrorController {
  constructor(private readonly trackLogErrorService: TrackLogErrorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTrackLogErrorDto) {
    await this.trackLogErrorService.create(dto);
    return { message: 'Error log saved' };
  }
}
