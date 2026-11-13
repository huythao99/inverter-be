import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MqttAuthService } from '../services/mqtt-auth.service';
import { MqttAuthController } from '../controllers/mqtt-auth.controller';
import {
  MqttCredential,
  MqttCredentialSchema,
} from '../models/mqtt-credential.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MqttCredential.name, schema: MqttCredentialSchema },
    ]),
  ],
  controllers: [MqttAuthController],
  providers: [MqttAuthService],
  exports: [MqttAuthService],
})
export class MqttAuthModule {}
