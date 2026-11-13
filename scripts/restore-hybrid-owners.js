#!/usr/bin/env node
/*
 * Restore hybrids that vanished from their owners' lists.
 *
 * Until HYBRID_EXCLUSIVE_OWNER existed, adding a hybrid id deleted it from
 * every other account ("moved to the new owner"). With duplicate ids (two
 * units flashed with the same number) or a unit added by several people,
 * owners lost their device. Their data, energy and settings were kept, keyed
 * by (userId, deviceId): this script recreates the missing device entries
 * from them and lists the ids owned by more than one account.
 *
 *   node scripts/restore-hybrid-owners.js            # report only (dry run)
 *   node scripts/restore-hybrid-owners.js --apply    # recreate the entries
 *
 * Reads MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE
 * from .env (same as the backend). Run it after deploying the backend with
 * the shared-ids change, else the next add moves units away again.
 *
 * The unit itself may still be offline: if another unit with the same id was
 * added later, it took over the broker account (hyb_<id>). The owner adds it
 * again in the app once (it then gets its own account).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set (.env)');
  const client = new MongoClient(uri, {
    auth: process.env.MONGODB_USERNAME
      ? { username: process.env.MONGODB_USERNAME, password: process.env.MONGODB_PASSWORD }
      : undefined,
    retryWrites: false,
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DATABASE || undefined);
  // Since the devices merge: one "devices" collection, hybrids are kind "hybrid".
  const devices = db.collection('devices');
  const sources = ['hybriddatas', 'hybridenergies', 'hybridsettings'];

  // Every (userId, deviceId) that ever had hybrid data / energy / settings.
  const pairs = new Map(); // "uid|id" -> { userId, deviceId, lastSeenAt, fw }
  for (const name of sources) {
    const rows = await db
      .collection(name)
      .aggregate([
        { $match: { deviceId: /^HybridControl\d+$/ } },
        {
          $group: {
            _id: { userId: '$userId', deviceId: '$deviceId' },
            lastSeenAt: { $max: '$lastSeenAt' },
            fw: { $last: '$info.FW' },
          },
        },
      ])
      .toArray();
    for (const r of rows) {
      if (!r._id.userId) continue;
      const k = `${r._id.userId}|${r._id.deviceId}`;
      const p = pairs.get(k) || { ...r._id, lastSeenAt: null };
      if (r.lastSeenAt && (!p.lastSeenAt || r.lastSeenAt > p.lastSeenAt)) p.lastSeenAt = r.lastSeenAt;
      pairs.set(k, p);
    }
  }

  const existing = new Set(
    (await devices.find({ kind: 'hybrid' }, { projection: { userId: 1, deviceId: 1 } }).toArray()).map(
      (d) => `${d.userId}|${d.deviceId}`,
    ),
  );
  // Units converted to inverter since (CMS "Chuyển về inverter"): their
  // hybrid entry was removed on purpose; they now run as GTIControl<N> or
  // GTIControl<90000 + N>.
  const inverterIds = new Set(
    (await devices.distinct('deviceId', { kind: 'inverter', deviceId: /^GTIControl\d+$/ })),
  );
  const nowInverter = (id) => {
    const digits = id.replace(/\D/g, '');
    const n = parseInt(digits, 10);
    // Zero-padded = a hybrid flashed as one (inverter id 90000 + N); else an
    // inverter board (same number).
    return digits.startsWith('0')
      ? inverterIds.has(`GTIControl${90000 + n}`)
      : inverterIds.has(`GTIControl${digits}`) || inverterIds.has(`GTIControl${90000 + n}`);
  };
  const missing = [...pairs.values()].filter(
    (p) => !existing.has(`${p.userId}|${p.deviceId}`) && !nowInverter(p.deviceId),
  );
  const skipped = [...pairs.values()].filter(
    (p) => !existing.has(`${p.userId}|${p.deviceId}`) && nowInverter(p.deviceId),
  );
  if (skipped.length) {
    console.log(`\nNot restored (now an inverter): ${skipped.map((p) => p.deviceId).join(', ')}`);
  }

  // Ids with more than one owner (after restoring).
  const owners = new Map();
  for (const p of pairs.values()) {
    owners.set(p.deviceId, [...(owners.get(p.deviceId) || []), p.userId]);
  }
  const shared = [...owners.entries()].filter(([, u]) => u.length > 1);

  // Who holds the old single broker account of each shared id.
  const creds = db.collection('mqttcredentials');
  console.log(`\nIds in more than one account: ${shared.length}`);
  for (const [id, uids] of shared) {
    const holder = await creds.findOne({ mqttUsername: `hyb_${id}`, kind: 'hybrid' });
    console.log(`  ${id}: ${uids.join(', ')}  (account hyb_${id} -> ${holder ? holder.userId : 'none'})`);
  }

  console.log(`\nMissing device entries: ${missing.length}`);
  for (const p of missing) {
    console.log(`  ${p.deviceId}  owner ${p.userId}  last seen ${p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : '?'}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Run with --apply to recreate the missing entries.');
  } else if (missing.length) {
    const now = new Date();
    const res = await devices.insertMany(
      missing.map((p) => ({
        kind: 'hybrid',
        userId: p.userId,
        deviceId: p.deviceId,
        deviceName: p.deviceId,
        firmwareVersion: '1.0.0',
        description: '',
        createdAt: now,
        updatedAt: now,
      })),
      { ordered: false },
    );
    console.log(`\nRecreated ${res.insertedCount} device entr${res.insertedCount === 1 ? 'y' : 'ies'}.`);
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
