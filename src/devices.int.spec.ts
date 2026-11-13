/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Model, connect } from 'mongoose';
import { DevicesModule } from './modules/devices.module';
import { DevicesService } from './services/devices.service';
import { InverterDeviceService } from './services/inverter-device.service';
import { MqttService } from './services/mqtt.service';
import { BlacklistDeviceService } from './services/blacklist-device.service';
import {
  BlacklistDevice,
  BlacklistDeviceSchema,
} from './models/blacklist-device.schema';
import { HybridDevice } from './models/hybrid-device.schema';
import { ChargerDevice } from './models/charger-device.schema';

// Needs a real MongoDB (discriminators, unique index across kinds):
//   MONGO_TEST_URI=mongodb://127.0.0.1:27017/devices_test npx jest devices.int
// Skipped otherwise (CI has no MongoDB). The database is dropped first.
const URI = process.env.MONGO_TEST_URI;
jest.setTimeout(30000);

(URI ? describe : describe.skip)('devices (real MongoDB)', () => {
  let mod: any;
  beforeAll(async () => {
    const c = await connect(URI!);
    await c.connection.db!.dropDatabase();
    await c.disconnect();
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI!),
        EventEmitterModule.forRoot(),
        DevicesModule,
        MongooseModule.forFeature([
          { name: BlacklistDevice.name, schema: BlacklistDeviceSchema },
        ]),
      ],
      providers: [
        InverterDeviceService,
        BlacklistDeviceService,
        {
          provide: MqttService,
          useValue: { emitDeviceAdded: jest.fn(), publish: jest.fn() },
        },
      ],
    }).compile();
    await mod.init();
  });
  afterAll(() => mod?.close());

  it('services write through kind models into one collection', async () => {
    const inv = mod.get(InverterDeviceService);
    await inv.create({
      userId: 'u1',
      deviceId: 'GTIControl1230',
      deviceName: 'Nha',
    });
    const H: Model<any> = mod.get(getModelToken(HybridDevice.name));
    const C: Model<any> = mod.get(getModelToken(ChargerDevice.name));
    await H.create({
      userId: 'u1',
      deviceId: 'HybridControl0015',
      deviceName: 'H',
    });
    await C.create({
      userId: 'u2',
      deviceId: 'ABCSolar0001',
      deviceName: 'brand',
    });
    expect((await inv.findByUserId('u1')).map((d: any) => d.deviceId)).toEqual([
      'GTIControl1230',
    ]);
    const raw = await H.db.collection('devices').find().toArray();
    expect(raw.map((d) => d.kind).sort()).toEqual([
      'charger',
      'hybrid',
      'inverter',
    ]);
    expect(
      (await H.db.listCollections()).map((c: any) => c.name),
    ).not.toContain('inverterdevices');
    const devs = mod.get(DevicesService);
    expect(await devs.kindOf('ABCSolar0001')).toBe('charger'); // brand prefix, kind stored
    expect(await devs.kindOf('HybridControl0015', 'u1')).toBe('hybrid');
    expect((await devs.listByUser('u1')).map((d: any) => d.kind)).toEqual([
      'hybrid',
      'inverter',
    ]);
    // The inverter service cannot touch a hybrid entry.
    expect(
      await inv.removeByUserIdAndDeviceId('u1', 'HybridControl0015'),
    ).toBeNull();
    expect(await H.countDocuments()).toBe(1);
  });

  it('a (user, id) pair exists once across kinds', async () => {
    const C: Model<any> = mod.get(getModelToken(ChargerDevice.name));
    await expect(
      C.create({ userId: 'u1', deviceId: 'GTIControl1230', deviceName: 'x' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('blacklist topic follows the stored kind (hybrid -> hybrid/...)', async () => {
    const seen: string[] = [];
    mod
      .get(EventEmitter2)
      .on('blacklist.changed', (p: any) => seen.push(p.topic));
    const bl = mod.get(BlacklistDeviceService) as unknown as {
      emitChange: (id: string, on: boolean) => Promise<void>;
    };
    await bl.emitChange('HybridControl0015', true);
    await bl.emitChange('ABCSolar0001', true);
    expect(seen).toEqual([
      'hybrid/u1/HybridControl0015/blacklist',
      'charger/u2/ABCSolar0001/blacklist',
    ]);
  });
});
