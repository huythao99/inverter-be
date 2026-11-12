#!/usr/bin/env node
/*
 * Remove fields of the dropped hybrid <-> inverter conversion feature:
 *   inverterdevices.hybridConversion
 *   hybriddevices.convertedFrom, hybriddevices.inverterConversion
 * The backend no longer reads or writes them (schemas cleaned 2026-11-12).
 *
 *   node scripts/cleanup-dead-fields.js            # count only (dry run)
 *   node scripts/cleanup-dead-fields.js --apply    # $unset them
 *
 * Reads MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE
 * from .env (same as the backend).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const DEAD = {
  inverterdevices: ['hybridConversion'],
  hybriddevices: ['convertedFrom', 'inverterConversion'],
};

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
  for (const [name, fields] of Object.entries(DEAD)) {
    const filter = { $or: fields.map((f) => ({ [f]: { $exists: true } })) };
    const col = db.collection(name);
    const n = await col.countDocuments(filter);
    // Still pending conversions (non-null) are worth a look before removing.
    const live = await col.countDocuments({ $or: fields.map((f) => ({ [f]: { $nin: [null] , $exists: true } })) });
    console.log(`${name}: ${n} document(s) with ${fields.join(' / ')} (${live} not null)`);
    if (APPLY && n > 0) {
      const unset = Object.fromEntries(fields.map((f) => [f, '']));
      const r = await col.updateMany(filter, { $unset: unset });
      console.log(`  removed from ${r.modifiedCount} document(s)`);
    }
  }
  if (!APPLY) console.log('\nDry run. Add --apply to remove the fields.');
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
