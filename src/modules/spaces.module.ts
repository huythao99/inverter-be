import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SpacesPendingDelete,
  SpacesPendingDeleteSchema,
} from '../models/spaces-pending-delete.schema';
import { SpacesService } from '../services/spaces.service';
import { SpacesCleanupService } from '../services/spaces-cleanup.service';

/**
 * DO Spaces client for firmware uploads from the CMS (see SpacesService), and
 * the delayed removal of deleted firmware files (SpacesCleanupService).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: SpacesPendingDelete.name, schema: SpacesPendingDeleteSchema },
    ]),
  ],
  providers: [SpacesService, SpacesCleanupService],
  exports: [SpacesService, SpacesCleanupService],
})
export class SpacesModule {}
