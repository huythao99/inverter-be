import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ShareService } from '../services/share.service';
import { CreateShareGroupDto } from '../dto/create-share-group.dto';
import { UpdateShareGroupDto } from '../dto/update-share-group.dto';

// Share groups - no auth, userId in the URL (mobile uses this style).
@Controller('api/share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  // Create a share group
  @Post(':userId')
  create(@Param('userId') userId: string, @Body() dto: CreateShareGroupDto) {
    return this.shareService.createGroup(userId, dto);
  }

  // List the user's share groups
  @Get(':userId')
  list(@Param('userId') userId: string) {
    return this.shareService.listGroups(userId);
  }

  // Share status + current computed value for a device
  @Get(':userId/device/:deviceId')
  deviceStatus(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.shareService.getShareStatus(userId, deviceId);
  }

  // Get one share group
  @Get(':userId/:groupId')
  async getOne(
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    const group = await this.shareService.getGroup(userId, groupId);
    if (!group) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return group;
  }

  // Update a share group (members / ratios / enabled)
  @Patch(':userId/:groupId')
  async update(
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateShareGroupDto,
  ) {
    const group = await this.shareService.updateGroup(userId, groupId, dto);
    if (!group) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return group;
  }

  // Delete a share group
  @Delete(':userId/:groupId')
  async remove(
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    const deleted = await this.shareService.deleteGroup(userId, groupId);
    if (!deleted) {
      throw new NotFoundException(`Share group ${groupId} not found`);
    }
    return { deleted: true, groupId };
  }
}
