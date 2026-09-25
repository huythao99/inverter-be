import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { UserChargerController } from '../controllers/user-charger.controller';
import { ChargerDeviceModule } from './charger-device.module';
import { ChargerSettingModule } from './charger-setting.module';
import { ChargerDataModule } from './charger-data.module';
import { ChargerFirmwareModule } from './charger-firmware.module';
import { MqttAuthModule } from './mqtt-auth.module';

// End-user charger API (/api/user/chargers). Firebase auth strategy is
// registered by UserApiModule; PassportModule sets the default strategy.
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'firebase' }),
    ChargerDeviceModule,
    ChargerSettingModule,
    ChargerDataModule,
    ChargerFirmwareModule,
    MqttAuthModule,
  ],
  controllers: [UserChargerController],
})
export class UserChargerModule {}
