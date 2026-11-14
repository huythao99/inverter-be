#!/usr/bin/env node
/**
 * CHỈ ĐỌC. So 3 bảng thiết bị cũ (bản sao lưu) với bảng "devices" sau migrate.
 *
 *   node scripts/check-devices.js                 # toàn bộ
 *   node scripts/check-devices.js <userId|deviceId>  # chi tiết 1 tài khoản / 1 máy
 *
 * Báo:
 *   1. (userId, deviceId) có ở bảng cũ nhưng KHÔNG có trong devices  -> mất
 *   2. có nhưng kind khác bảng cũ                                    -> hiện sai tab
 *   3. dòng devices thiếu kind / kind lạ                            -> không hiện ở đâu
 *   4. dòng devices mới (không có ở bảng cũ), kind lệch tiền tố mã máy
 * Đọc MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE từ .env.
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const SOURCES = { inverterdevices: 'inverter', chargerdevices: 'charger', hybriddevices: 'hybrid' };
const PREFIX = { inverter: /^GTIControl/, charger: /^(GTISolar|ChargerControl)/, hybrid: /^HybridControl/ };
const guess = (id) => Object.keys(PREFIX).find((k) => PREFIX[k].test(String(id))) || '?';
const key = (d) => `${d.userId}|${d.deviceId}`;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set (.env)');
  const client = new MongoClient(uri, {
    auth: process.env.MONGODB_USERNAME
      ? { username: process.env.MONGODB_USERNAME, password: process.env.MONGODB_PASSWORD }
      : undefined,
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DATABASE || undefined);
  const arg = process.argv[2];
  const filter = arg ? { $or: [{ userId: arg }, { deviceId: arg }] } : {};
  const proj = { projection: { userId: 1, deviceId: 1, kind: 1, deviceName: 1, createdAt: 1, updatedAt: 1 } };

  try {
    const old = new Map(); // key -> {kind, coll, doc}
    for (const [coll, kind] of Object.entries(SOURCES)) {
      for (const d of await db.collection(coll).find(filter, proj).toArray()) old.set(key(d), { kind, coll, d });
    }
    const devs = await db.collection('devices').find(filter, proj).toArray();
    const now = new Map();
    for (const d of devs) now.set(key(d), [...(now.get(key(d)) || []), d]);

    const counts = {};
    for (const d of devs) counts[d.kind ?? '(thiếu)'] = (counts[d.kind ?? '(thiếu)'] || 0) + 1;
    console.log(`Bảng cũ: ${old.size} cặp (userId, deviceId). devices: ${devs.length} dòng`, JSON.stringify(counts));

    const missing = [], wrongKind = [];
    for (const [k, o] of old) {
      const n = now.get(k);
      if (!n) missing.push(o);
      else if (!n.some((x) => x.kind === o.kind)) wrongKind.push({ o, n });
    }
    const noKind = devs.filter((d) => !Object.values(SOURCES).includes(d.kind));
    const fresh = devs.filter((d) => !old.has(key(d)));
    const freshOdd = fresh.filter((d) => guess(d.deviceId) !== '?' && guess(d.deviceId) !== d.kind);

    const show = (title, rows, fmt) => {
      console.log(`\n${rows.length ? '!!' : 'OK'} ${title}: ${rows.length}`);
      for (const r of rows.slice(0, 50)) console.log('   ' + fmt(r));
      if (rows.length > 50) console.log(`   … và ${rows.length - 50} dòng nữa`);
    };
    show('1. Có ở bảng cũ, MẤT trong devices', missing, (o) => `${key(o.d)}  (${o.coll}) "${o.d.deviceName ?? ''}"`);
    show('2. Sai kind so với bảng cũ', wrongKind, ({ o, n }) => `${key(o.d)}  cũ=${o.kind}  devices=${n.map((x) => x.kind).join(',')}`);
    show('3. devices thiếu kind / kind lạ', noKind, (d) => `${key(d)}  kind=${d.kind}`);
    show('4a. Dòng mới sau deploy (không có ở bảng cũ)', fresh, (d) => `${key(d)}  kind=${d.kind}  tạo ${d.createdAt?.toISOString?.() ?? '?'}`);
    show('4b. Trong đó kind lệch tiền tố mã máy', freshOdd, (d) => `${key(d)}  kind=${d.kind}  mã gợi ý=${guess(d.deviceId)}`);

    if (arg) {
      console.log('\n== Chi tiết');
      for (const [, o] of old) console.log(`   cũ    ${o.coll.padEnd(16)} ${key(o.d)} "${o.d.deviceName ?? ''}"`);
      for (const d of devs) console.log(`   mới   devices[${d.kind}]`.padEnd(30) + ` ${key(d)} "${d.deviceName ?? ''}" _id=${d._id}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
