import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SpacesService } from '../services/spaces.service';

/** DO Spaces client for firmware uploads from the CMS (see SpacesService). */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
