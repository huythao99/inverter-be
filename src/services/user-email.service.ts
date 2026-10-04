import { Injectable, Logger } from '@nestjs/common';
import { FirebaseConfig } from '../config/firebase.config';

/** What the CMS shows about a device owner (from Firebase Auth). */
export interface OwnerInfo {
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
}

const CACHE_MS = 30 * 60 * 1000;
const BATCH = 100; // Firebase getUsers() limit

/**
 * Firebase uid -> email (and name / phone) for the CMS. Emails are not stored
 * in MongoDB: devices only carry the Firebase uid. Looked up in batches of
 * 100 and cached 30 min (misses too), so a device page costs at most one
 * Firebase call. Never throws: unknown owner -> null fields.
 */
@Injectable()
export class UserEmailService {
  private readonly logger = new Logger(UserEmailService.name);
  private readonly cache = new Map<string, { at: number; info: OwnerInfo }>();

  constructor(private readonly firebase: FirebaseConfig) {}

  private static empty(): OwnerInfo {
    return { email: null, displayName: null, phoneNumber: null };
  }

  async ownersOf(uids: string[]): Promise<Map<string, OwnerInfo>> {
    const out = new Map<string, OwnerInfo>();
    const now = Date.now();
    const missing: string[] = [];
    for (const uid of new Set(uids.filter(Boolean))) {
      const hit = this.cache.get(uid);
      if (hit && now - hit.at < CACHE_MS) out.set(uid, hit.info);
      else missing.push(uid);
    }
    if (!missing.length) return out;

    let auth: ReturnType<FirebaseConfig['getAuth']> | null = null;
    try {
      auth = this.firebase.getAuth();
    } catch {
      // Firebase not configured: no emails, but the page still works.
    }
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const found = new Map<string, OwnerInfo>();
      if (auth) {
        try {
          const res = await auth.getUsers(chunk.map((uid) => ({ uid })));
          for (const u of res.users) {
            found.set(u.uid, {
              email: u.email ?? null,
              displayName: u.displayName ?? null,
              phoneNumber: u.phoneNumber ?? null,
            });
          }
        } catch (e) {
          this.logger.warn(`getUsers: ${(e as Error).message}`);
          // Not cached: try again on the next request.
          for (const uid of chunk) out.set(uid, UserEmailService.empty());
          continue;
        }
      }
      for (const uid of chunk) {
        const info = found.get(uid) ?? UserEmailService.empty();
        out.set(uid, info);
        if (auth) this.cache.set(uid, { at: now, info });
      }
    }
    if (this.cache.size > 20000) this.cache.clear();
    return out;
  }

  /** Rows (each with a userId) + ownerEmail / ownerName / ownerPhone. */
  async withOwners<T extends { userId: string }>(
    rows: T[],
  ): Promise<
    Array<
      T & {
        ownerEmail: string | null;
        ownerName: string | null;
        ownerPhone: string | null;
      }
    >
  > {
    const owners = await this.ownersOf(rows.map((r) => r.userId));
    return rows.map((r) => {
      const o = owners.get(r.userId) ?? UserEmailService.empty();
      return {
        ...r,
        ownerEmail: o.email,
        ownerName: o.displayName,
        ownerPhone: o.phoneNumber,
      };
    });
  }

  /**
   * A CMS search that looks like an email -> the uid of that account, so
   * "search by email" finds the user's devices. null otherwise.
   */
  async uidForSearch(search?: string): Promise<string | null> {
    const s = (search ?? '').trim();
    if (!s.includes('@') || s.length > 254) return null;
    return this.uidForEmail(s);
  }

  /** Firebase uid of an email, null when there is no such user. */
  async uidForEmail(email: string): Promise<string | null> {
    try {
      const u = await this.firebase.getAuth().getUserByEmail(email.trim());
      return u.uid;
    } catch {
      return null;
    }
  }
}
