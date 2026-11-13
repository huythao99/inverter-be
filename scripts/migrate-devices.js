#!/usr/bin/env node
/*
 * Gộp 3 bảng thiết bị (inverterdevices, chargerdevices, hybriddevices) vào
 * MỘT bảng "devices" có trường kind (inverter / charger / hybrid).
 * Backend từ bản này đọc / ghi "devices" (Mongoose discriminators).
 *
 *   node scripts/migrate-devices.js              # chỉ kiểm tra (dry run)
 *   node scripts/migrate-devices.js --apply      # chép sang "devices"
 *   node scripts/migrate-devices.js --rollback   # chép "devices" về 3 bảng cũ
 *
 * Thứ tự khi deploy (mất vài giây đến vài phút, tùy số máy):
 *   1. git pull && npm ci && npm run build     (backend cũ vẫn chạy)
 *   2. node scripts/migrate-devices.js         (xem báo cáo, phải 0 xung đột)
 *   3. sudo systemctl stop nestjs
 *   4. node scripts/migrate-devices.js --apply
 *   5. sudo systemctl start nestjs
 * Quay lại bản cũ: stop, --rollback, checkout bản backend cũ, build, start.
 *
 * - Giữ nguyên _id; chạy lại bao nhiêu lần cũng được (chỉ thêm dòng còn thiếu).
 * - KHÔNG xoá 3 bảng cũ: để lại làm bản sao lưu, xoá tay khi đã chạy ổn.
 * - Bỏ các trường của tính năng chuyển đổi hybrid <-> inverter đã gỡ.
 * Đọc MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE từ .env.
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
const SOURCES = { inverterdevices: 'inverter', chargerdevices: 'charger', hybriddevices: 'hybrid' };
const PREFIX = { inverter: /^GTIControl/, charger: /^ChargerControl/, hybrid: /^HybridControl/ };
const DEAD = ['hybridConversion', 'convertedFrom', 'inverterConversion'];
const TARGET = 'devices';

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set (.env)');
  const client = new MongoClient(uri, {
    auth: process.env.MONGODB_USERNAME
      ? { username: process.env.MONGODB_USERNAME, password: process.env.MONGODB_PASSWORD }
      : undefined,
    retryWrites: false,
  });
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DATABASE || undefined) };
}

async function check(db) {
  const all = new Map(); // "uid|id" -> [kind...]
  let problems = 0;
  for (const [coll, kind] of Object.entries(SOURCES)) {
    const col = db.collection(coll);
    const n = await col.countDocuments();
    const noKey = await col.countDocuments({ $or: [{ userId: { $in: [null, ''] } }, { deviceId: { $in: [null, ''] } }] });
    const dead = await col.countDocuments({ $or: DEAD.map((f) => ({ [f]: { $exists: true } })) });
    const odd = await col.countDocuments({ deviceId: { $not: PREFIX[kind] } });
    console.log(`  ${coll.padEnd(16)} ${String(n).padStart(6)} dòng  (thiếu userId/deviceId: ${noKey}, trường thừa: ${dead}, mã không đúng tiền tố: ${odd})`);
    if (noKey) problems++;
    for (const d of await col.find({}, { projection: { userId: 1, deviceId: 1 } }).toArray()) {
      const k = `${d.userId}|${d.deviceId}`;
      all.set(k, [...(all.get(k) || []), kind]);
    }
  }
  const clash = [...all.entries()].filter(([, kinds]) => kinds.length > 1);
  if (clash.length) {
    problems++;
    console.log(`\n  !! ${clash.length} cặp (userId, deviceId) có ở nhiều bảng / trùng — phải xử lý trước:`);
    for (const [k, kinds] of clash.slice(0, 30)) console.log(`     ${k}: ${kinds.join(', ')}`);
  }
  const existing = (await db.listCollections({ name: TARGET }).toArray()).length
    ? await db.collection(TARGET).countDocuments()
    : 0;
  console.log(`\n  "${TARGET}" hiện có ${existing} dòng`);
  return { problems, total: all.size };
}

async function apply(db) {
  const target = db.collection(TARGET);
  // Index trước: lỗi trùng hiện ra ngay khi chép, không phải lúc backend khởi động.
  await target.createIndex({ userId: 1, deviceId: 1 }, { unique: true });
  await target.createIndex({ deviceId: 1 });
  for (const [coll, kind] of Object.entries(SOURCES)) {
    const docs = await db.collection(coll).find({}).toArray();
    if (docs.length === 0) continue;
    const ops = docs.map((d) => {
      const doc = { ...d, kind };
      for (const f of DEAD) delete doc[f];
      return { updateOne: { filter: { _id: d._id }, update: { $setOnInsert: doc }, upsert: true } };
    });
    const r = await target.bulkWrite(ops, { ordered: false });
    console.log(`  ${coll} -> ${TARGET}: ${r.upsertedCount} thêm mới, ${docs.length - r.upsertedCount} đã có`);
  }
  // Kiểm lại: mỗi dòng nguồn phải có trong devices với đúng kind.
  let bad = 0;
  for (const [coll, kind] of Object.entries(SOURCES)) {
    const src = await db.collection(coll).countDocuments();
    const dst = await target.countDocuments({ kind });
    const ok = dst >= src;
    if (!ok) bad++;
    console.log(`  kiểm tra ${kind.padEnd(8)}: nguồn ${src}, devices ${dst} ${ok ? 'OK' : '!! THIẾU'}`);
  }
  if (bad) throw new Error('Thiếu dòng sau khi chép — KHÔNG start backend, xem lỗi ở trên');
}

async function rollback(db) {
  const target = db.collection(TARGET);
  for (const [coll, kind] of Object.entries(SOURCES)) {
    const docs = await target.find({ kind }).toArray();
    if (docs.length === 0) continue;
    const ops = docs.map((d) => {
      const doc = { ...d };
      delete doc.kind;
      return { replaceOne: { filter: { _id: d._id }, replacement: doc, upsert: true } };
    });
    // Dòng đã xoá trên bản mới cũng phải xoá ở bảng cũ.
    const keep = docs.map((d) => d._id);
    const del = await db.collection(coll).deleteMany({ _id: { $nin: keep } });
    const r = await db.collection(coll).bulkWrite(ops, { ordered: false });
    console.log(`  ${TARGET}[${kind}] -> ${coll}: ${r.upsertedCount} thêm, ${r.modifiedCount} cập nhật, ${del.deletedCount} xoá`);
  }
}

async function main() {
  const { client, db } = await connect();
  try {
    if (ROLLBACK) {
      console.log('== Rollback: devices -> 3 bảng cũ');
      await rollback(db);
      return;
    }
    console.log('== Kiểm tra 3 bảng thiết bị cũ');
    const { problems, total } = await check(db);
    if (!APPLY) {
      console.log(`\nDry run: ${total} thiết bị, ${problems} vấn đề chặn. Thêm --apply để chép.`);
      return;
    }
    if (problems) throw new Error('Còn vấn đề chặn ở trên, chưa chép');
    console.log('\n== Chép sang devices');
    await apply(db);
    console.log('\nXong. Start backend mới. 3 bảng cũ vẫn giữ nguyên làm bản sao lưu.');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
