import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChargerDataService } from '../services/charger-data.service';
import { ChargerData, ChargerDataSchema } from '../models/charger-data.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChargerData.name, schema: ChargerDataSchema },
    ]),
  ],
  providers: [ChargerDataService],
  exports: [ChargerDataService],
})
export class ChargerDataModule {}
