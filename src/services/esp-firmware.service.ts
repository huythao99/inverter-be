import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  EspFirmware,
  EspFirmwareDocument,
} from '../models/esp-firmware.schema';
import { SpacesService } from './spaces.service';
import {
  ESP_PRODUCTS,
  EspFirmwareChannel,
  EspProduct,
  FIRMWARE_BASE_URL,
  activeEspFirmware,
  compareFirmwareVersions,
  setActiveEspFirmware,
  activeRollout,
} from './firmware.service';

const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const CHANNELS: EspFirmwareChannel[] = ['stable', 'beta'];

// ESP32 app image: header magic, and the esp_app_desc_t magic right after the
// 24-byte image header + 8-byte first segment header.
const ESP_IMAGE_MAGIC = 0xe9;
const ESP_APP_DESC_MAGIC = 0xabcd5432;
const ESP_APP_DESC_OFFSET = 32;

/**
 * ESP32 firmware builds (inverter / charger / hybrid) uploaded from the CMS
 * (DO Spaces) and which one is active per product + channel. The active builds are mirrored into memory
 * (firmware.service setActiveEspFirmware) so version checks stay synchronous.
 */
@Injectable()
export class EspFirmwareService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EspFirmwareService.name);
  private refreshTimer: NodeJS.Timeout | null = null;

  /** Public base URL ({baseUrl}/{product}/{version}/firmware.bin). */
  readonly baseUrl: string;
  /** Bucket folder behind baseUrl (nginx /firmware/esp32/ -> firmware/esp32/). */
  readonly spacesPrefix: string;
  /** Size of the OTA app partition (default partition table: 1280 KB). */
  readonly maxBytes: number;
  /**
   * Per-product OTA slot size. The inverter uses the Arduino default table
   * (1280 KB, fixed for units in the field); the charger ships with its own
   * partitions.csv (app0/app1 = 0x1C0000 = 1792 KB).
   */
  readonly maxBytesByProduct: Record<EspProduct, number>;

  constructor(
    @InjectModel(EspFirmware.name)
    private readonly model: Model<EspFirmwareDocument>,
    private readonly spaces: SpacesService,
    config: ConfigService,
  ) {
    this.baseUrl = config
      .get<string>('ESP_FIRMWARE_BASE_URL', `${FIRMWARE_BASE_URL}/esp32`)
      .replace(/\/+$/, '');
    this.spacesPrefix = config
      .get<string>('ESP_SPACES_PREFIX', 'firmware/esp32')
      .replace(/^\/+|\/+$/g, '');
    this.maxBytes = Number(config.get<string>('ESP_APP_MAX_BYTES', '1310720'));
    this.maxBytesByProduct = {
      inverter: this.maxBytes,
      charger: Number(
        config.get<string>('ESP_CHARGER_APP_MAX_BYTES', String(0x1c0000)),
      ),
      hybrid: this.maxBytes,
    };
  }

  async onModuleInit() {
    await this.migrate();
    await this.refreshActive();
    // Other instances / manual DB edits: re-read now and then.
    this.refreshTimer = setInterval(() => {
      this.refreshActive().catch((err: Error) =>
        this.logger.warn(`refresh failed: ${err.message}`),
      );
    }, 60000);
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /**
   * Builds uploaded before the product field existed are inverter builds, and
   * the old unique index on version alone would block the same version for
   * another product.
   */
  private async migrate(): Promise<void> {
    await this.model
      .updateMany(
        { product: { $exists: false } },
        { $set: { product: 'inverter' } },
      )
      .exec();
    try {
      await this.model.collection.dropIndex('version_1');
    } catch {
      // not there (fresh install)
    }
  }

  /** Mirror the active build of each product + channel into memory. */
  async refreshActive(): Promise<void> {
    const docs = await this.model
      .find({ channels: { $in: CHANNELS } })
      .lean()
      .exec();
    for (const product of ESP_PRODUCTS) {
      for (const ch of CHANNELS) {
        const fw = docs.find(
          (d) =>
            (d.product ?? 'inverter') === product && d.channels?.includes(ch),
        );
        setActiveEspFirmware(
          product,
          ch,
          fw ? { version: fw.version, url: fw.url } : null,
        );
      }
    }
  }

  list(product?: EspProduct) {
    return this.model
      .find(product ? { product } : {})
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  config() {
    const activeByProduct = Object.fromEntries(
      ESP_PRODUCTS.map((p) => [
        p,
        {
          stable: activeEspFirmware('stable', p),
          beta: activeEspFirmware('beta', p),
        },
      ]),
    ) as Record<
      EspProduct,
      Record<EspFirmwareChannel, ReturnType<typeof activeEspFirmware>>
    >;
    return {
      baseUrl: this.baseUrl,
      pathTemplate: `${this.baseUrl}/{product}/{version}/firmware.bin`,
      uploadEnabled: this.spaces.enabled,
      maxBytes: this.maxBytes,
      maxBytesByProduct: this.maxBytesByProduct,
      active: activeByProduct,
    };
  }

  /**
   * Upload a build (the .pio/build/esp32dev/firmware.bin) and optionally make
   * it active on a channel right away.
   */
  async upload(
    dto: {
      product: EspProduct;
      version: string;
      notes?: string;
      activate?: EspFirmwareChannel;
    },
    bin: Buffer,
  ) {
    this.spaces.assertEnabled();
    const product = dto.product;
    if (!ESP_PRODUCTS.includes(product)) {
      throw new BadRequestException(
        `product must be one of ${ESP_PRODUCTS.join(', ')}`,
      );
    }
    const version = dto.version?.trim();
    if (!version || !VERSION_RE.test(version)) {
      throw new BadRequestException('Version must look like 1.0.15');
    }
    this.checkImage(bin, version, product);

    if (await this.model.exists({ product, version })) {
      throw new ConflictException(
        `${product} v${version} is already uploaded - bump the version instead of replacing it`,
      );
    }
    const key = `${this.spacesPrefix}/${product}/${version}/firmware.bin`;
    if (await this.spaces.exists(key)) {
      throw new ConflictException(
        `${key} already exists on Spaces - bump the version instead of replacing it`,
      );
    }
    await this.spaces.putPublic(key, bin, 'application/octet-stream');

    const url = `${this.baseUrl}/${product}/${version}/firmware.bin`;
    let created: EspFirmwareDocument;
    try {
      created = await this.model.create({
        product,
        version,
        url,
        key,
        size: bin.length,
        sha256: crypto.createHash('sha256').update(bin).digest('hex'),
        md5: crypto.createHash('md5').update(bin).digest('hex'),
        channels: [],
        notes: dto.notes?.trim() ?? '',
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(
          `${product} v${version} is already uploaded`,
        );
      }
      throw err;
    }
    this.logger.log(
      `Uploaded ESP32 ${product} firmware v${version} (${bin.length} B)`,
    );

    const saved = created.toObject() as EspFirmware;
    const warning = await this.checkServed(url, bin.length);
    if (dto.activate) {
      if (warning) {
        // Never point devices at a URL that doesn't serve the file.
        return {
          ...saved,
          warning: `${warning} - not activated`,
        };
      }
      return {
        ...(await this.activate(String(created._id), dto.activate)),
        warning,
      };
    }
    return { ...saved, warning };
  }

  /**
   * Make a build the active one of its product's channel (the previous one of
   * the same product is released).
   */
  async get(id: string) {
    if (!/^[a-f0-9]{24}$/i.test(id)) return null;
    return this.model.findById(id).lean().exec();
  }

  async activate(id: string, channel: EspFirmwareChannel) {
    if (!CHANNELS.includes(channel)) {
      throw new BadRequestException('channel must be stable or beta');
    }
    const fw = await this.model.findById(id).exec();
    if (!fw) throw new NotFoundException('ESP32 firmware not found');
    const product = fw.product ?? 'inverter';
    await this.model
      .updateMany(
        { product, channels: channel, _id: { $ne: fw._id } },
        { $pull: { channels: channel } },
      )
      .exec();
    await this.model
      .updateOne({ _id: fw._id }, { $addToSet: { channels: channel } })
      .exec();
    await this.refreshActive();
    this.logger.log(
      `ESP32 ${product} firmware v${fw.version} is now active on ${channel}`,
    );
    return this.model.findById(id).lean().exec();
  }

  async remove(id: string) {
    const fw = await this.model.findById(id).lean().exec();
    if (!fw) throw new NotFoundException('ESP32 firmware not found');
    if (fw.channels?.length) {
      throw new BadRequestException(
        `v${fw.version} is active on ${fw.channels.join(', ')} - activate another build first`,
      );
    }
    const r = activeRollout();
    if (r && r.url === fw.url) {
      throw new BadRequestException(
        `v${fw.version} is being rolled out - finish or abort the rollout first`,
      );
    }
    // The file stays on Spaces (a device may still be downloading it).
    await this.model.deleteOne({ _id: fw._id }).exec();
    return { message: 'Deleted' };
  }

  /** ESP32 app image + the version string the firmware reports. */
  private checkImage(bin: Buffer, version: string, product: EspProduct) {
    if (!bin?.length) throw new BadRequestException('firmware.bin is empty');
    const maxBytes = this.maxBytesByProduct[product] ?? this.maxBytes;
    if (bin.length > maxBytes) {
      throw new BadRequestException(
        `firmware.bin is ${bin.length} B, larger than the ${product} OTA partition (${maxBytes} B)`,
      );
    }
    if (
      bin[0] !== ESP_IMAGE_MAGIC ||
      bin.length < ESP_APP_DESC_OFFSET + 4 ||
      bin.readUInt32LE(ESP_APP_DESC_OFFSET) !== ESP_APP_DESC_MAGIC
    ) {
      throw new BadRequestException(
        'Not an ESP32 app image (use .pio/build/esp32dev/firmware.bin, not bootloader/partitions/merged bin)',
      );
    }
    // The build must contain currentFirmwareVersion as a C string, otherwise
    // the device would report another version after the update (and be
    // offered the same update again and again).
    if (!containsCString(bin, version)) {
      throw new BadRequestException(
        `The file does not contain the version string "${version}" - check currentFirmwareVersion in shared_state.cpp`,
      );
    }
    const stable = activeEspFirmware('stable', product);
    if (compareFirmwareVersions(version, stable.version) <= 0) {
      this.logger.warn(
        `Uploading ${product} v${version}, not newer than stable ${stable.version}`,
      );
    }
  }

  private async checkServed(url: string, size: number): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length'));
      if (len && len !== size) {
        return `${url} serves ${len} B instead of ${size} B`;
      }
      return null;
    } catch (err) {
      return `Uploaded to Spaces, but ${url} is not reachable (${(err as Error).message}) - check the nginx /firmware/esp32/ proxy`;
    }
  }
}

/** True if `text` occurs as a whole NUL-terminated string. */
function containsCString(bin: Buffer, text: string): boolean {
  const needle = Buffer.from(`${text}\0`, 'latin1');
  let from = 0;
  for (;;) {
    const i = bin.indexOf(needle, from);
    if (i < 0) return false;
    const prev = i > 0 ? bin[i - 1] : 0;
    // not the tail of a longer version / number ("11.0.15")
    if (!((prev >= 0x30 && prev <= 0x39) || prev === 0x2e)) return true;
    from = i + 1;
  }
}
