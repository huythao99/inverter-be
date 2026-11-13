import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MqttCredential,
  MqttCredentialSchema,
} from '../models/mqtt-credential.schema';
import { DailyTotalsModule } from './daily-totals.module';
import { MqttAuthModule } from './mqtt-auth.module';
import { HassAccountService } from '../hass/hass-account.service';
import { HassController } from '../hass/hass.controller';
import { HassBridgeService } from '../hass/hass-bridge.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'firebase' }),
    DailyTotalsModule,
    MqttAuthModule,
    MongooseModule.forFeature([
      { name: MqttCredential.name, schema: MqttCredentialSchema },
    ]),
  ],
  controllers: [HassController],
  providers: [HassBridgeService, HassAccountService],
  exports: [HassBridgeService],
})
export class HassModule {}
