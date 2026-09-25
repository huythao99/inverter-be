import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * DigitalOcean Spaces (S3-compatible) — where firmware files are stored.
 * The firmware server (nginx) forwards /firmware/... to the bucket, so a file
 * uploaded to key "firmware/stm/inverter/3.4.1/app.bin" is served at
 * https://giabao-inverter.com/firmware/stm/inverter/3.4.1/app.bin.
 *
 * Env (secrets only in .env, never in code):
 *   DO_SPACES_KEY, DO_SPACES_SECRET   Spaces access key (DO -> API -> Spaces Keys)
 *   DO_SPACES_BUCKET                  default "gticontrol"
 *   DO_SPACES_REGION                  default "sgp1"
 *   DO_SPACES_ENDPOINT                default https://{region}.digitaloceanspaces.com
 */
@Injectable()
export class SpacesService {
  private readonly logger = new Logger(SpacesService.name);
  private readonly client: S3Client | null;
  readonly bucket: string;
  readonly region: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('DO_SPACES_KEY');
    const secret = config.get<string>('DO_SPACES_SECRET');
    this.bucket = config.get<string>('DO_SPACES_BUCKET', 'gticontrol');
    this.region = config.get<string>('DO_SPACES_REGION', 'sgp1');
    const endpoint = config.get<string>(
      'DO_SPACES_ENDPOINT',
      `https://${this.region}.digitaloceanspaces.com`,
    );
    this.client =
      key && secret
        ? new S3Client({
            region: 'us-east-1', // Spaces ignores it; the endpoint picks the region
            endpoint,
            forcePathStyle: false,
            credentials: { accessKeyId: key, secretAccessKey: secret },
            // Newer SDKs add CRC checksum headers by default; keep requests
            // plain for S3-compatible stores.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          })
        : null;
    if (!this.client) {
      this.logger.warn(
        'DO_SPACES_KEY / DO_SPACES_SECRET not set: firmware upload from the CMS is disabled',
      );
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Throws 503 when uploads are not configured (checked before any work). */
  assertEnabled(): void {
    this.requireClient();
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'File upload is not configured on the server (DO_SPACES_KEY / DO_SPACES_SECRET)',
      );
    }
    return this.client;
  }

  /** Public URL of a key straight from the bucket (bypassing nginx). */
  directUrl(key: string): string {
    return `https://${this.bucket}.${this.region}.digitaloceanspaces.com/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.requireClient().send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const e = err as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /** Upload a public-read object (devices download it without credentials). */
  async putPublic(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ACL: 'public-read',
        ContentType: contentType,
        CacheControl: 'no-cache',
      }),
    );
    this.logger.log(`Uploaded ${key} (${body.length} B)`);
  }
}
