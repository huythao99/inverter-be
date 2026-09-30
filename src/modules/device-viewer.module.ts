import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import {
  DeviceShareLink,
  DeviceShareLinkSchema,
  DeviceViewer,
  DeviceViewerSchema,
} from '../models/device-viewer.schema';
import {
  InverterDevice,
  InverterDeviceSchema,
} from '../models/inverter-device.schema';
import {
  ChargerDevice,
  ChargerDeviceSchema,
} from '../models/charger-device.schema';
import { DeviceViewerService } from '../services/device-viewer.service';
import { PublicStreamService } from '../services/public-stream.service';
import {
  DeviceViewerController,
  PublicViewController,
} from '../controllers/device-viewer.controller';

// Global: FirebaseAuthGuard (used by every user controller) and the MQTT ACL
// need DeviceViewerService to honour read-only shares.
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'firebase' }),
    MongooseModule.forFeature([
      { name: DeviceViewer.name, schema: DeviceViewerSchema },
      { name: DeviceShareLink.name, schema: DeviceShareLinkSchema },
      { name: InverterDevice.name, schema: InverterDeviceSchema },
      { name: ChargerDevice.name, schema: ChargerDeviceSchema },
    ]),
  ],
  controllers: [DeviceViewerController, PublicViewController],
  providers: [DeviceViewerService, PublicStreamService],
  exports: [DeviceViewerService],
})
export class DeviceViewerModule {}
