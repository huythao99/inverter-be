import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  SpacesPendingDelete,
  SpacesPendingDeleteDocument,
} from '../models/spaces-pending-delete.schema';
import { SpacesService } from './spaces.service';

/** Registry model holding the records of each kind (by Mongoose model name). */
const REGISTRY_MODEL: Record<SpacesPendingDelete['kind'], string> = {
  esp: 'EspFirmware',
  stm: 'StmFirmware',
};
const MAX_ATTEMPTS = 10;

/**
 * Deleting a firmware in the CMS removes its record at once, and its files on
 * DO Spaces only after a delay (default 60 min, SPACES_DELETE_DELAY_MIN), so a
 * device that already started downloading it can finish. The file is kept if
 * a record with the same product + version was uploaded again meanwhile.
 * Runs on the primary pm2 instance only.
 */
@Injectable()
export class SpacesCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpacesCleanupService.name);
  private readonly delayMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(SpacesPendingDelete.name)
    private readonly pending: Model<SpacesPendingDeleteDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly spaces: SpacesService,
    config: ConfigService,
  ) {
    const min = Number(config.get<string>('SPACES_DELETE_DELAY_MIN', '60'));
    this.delayMs = (Number.isFinite(min) && min >= 0 ? min : 60) * 60_000;
  }

  onModuleInit(): void {
    const instance = process.env.NODE_APP_INSTANCE;
    const primary = process.env.MQTT_PRIMARY_INSTANCE || '0';
    if (instance !== undefined && instance !== primary) return;
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runDue(), 5 * 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Minutes before a scheduled file is really deleted (for CMS messages). */
  get delayMinutes(): number {
    return Math.round(this.delayMs / 60_000);
  }

  /** Remember files to delete later. Never throws (the record is gone already). */
  async schedule(
    kind: SpacesPendingDelete['kind'],
    product: string,
    version: string,
    keys: string[],
  ): Promise<boolean> {
    if (!this.spaces.enabled || keys.length === 0) return false;
    try {
      await this.pending.create({
        kind,
        product,
        version,
        keys,
        deleteAfter: new Date(Date.now() + this.delayMs),
      });
      return true;
    } catch (e) {
      this.logger.warn(
        `could not schedule Spaces delete of ${keys.join(', ')}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /** Delete every file whose delay has passed. */
  async runDue(now = new Date()): Promise<number> {
    if (this.running || !this.spaces.enabled) return 0;
    this.running = true;
    let deleted = 0;
    try {
      const due = await this.pending
        .find({ deleteAfter: { $lte: now } })
        .limit(50)
        .exec();
      for (const job of due) {
        if (await this.reuploaded(job)) {
          this.logger.log(
            `kept ${job.kind} ${job.product} v${job.version} on Spaces: uploaded again`,
          );
          await this.pending.deleteOne({ _id: job._id }).exec();
          continue;
        }
        try {
          for (const key of job.keys) await this.spaces.deleteObject(key);
          await this.pending.deleteOne({ _id: job._id }).exec();
          deleted += job.keys.length;
          this.logger.log(`deleted from Spaces: ${job.keys.join(', ')}`);
        } catch (e) {
          const attempts = job.attempts + 1;
          const msg = (e as Error).message;
          if (attempts >= MAX_ATTEMPTS) {
            this.logger.error(
              `giving up deleting ${job.keys.join(', ')}: ${msg}`,
            );
            await this.pending.deleteOne({ _id: job._id }).exec();
          } else {
            await this.pending
              .updateOne(
                { _id: job._id },
                {
                  attempts,
                  lastError: msg,
                  deleteAfter: new Date(now.getTime() + attempts * 10 * 60_000),
                },
              )
              .exec();
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Spaces cleanup failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return deleted;
  }

  private async reuploaded(job: SpacesPendingDeleteDocument): Promise<boolean> {
    const model = this.connection.models[REGISTRY_MODEL[job.kind]];
    if (!model) return true; // can't check: keep the file (safe side)
    const hit = await model
      .exists({ product: job.product, version: job.version })
      .exec();
    return !!hit;
  }
}
