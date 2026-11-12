#!/usr/bin/env node
/*
 * Kiểm tra kiến trúc database so với code (CHỈ ĐỌC, không sửa gì).
 *
 *   npm run build && node scripts/db-audit.js
 *
 * Lấy "đúng" từ các schema đã build (dist/models/*.schema.js): tên
 * collection, index, các trường. Rồi so với MongoDB thật:
 *   1. Collection: thiếu / thừa (không có schema nào dùng), số document, dung lượng
 *   2. Index: thiếu so với schema, thừa trên DB (tốn RAM / chậm ghi), TTL
 *   3. Trường lạ: trường có trên DB mà schema không khai báo (lấy mẫu)
 *   4. Trùng khoá (userId, deviceId) trong collection thiết bị
 *   5. Dữ liệu mồ côi: data / setting / điện năng không còn thiết bị
 *   6. Mã máy thuộc nhiều tài khoản, máy mang mã sai loại
 * Đọc MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE từ .env.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const SAMPLE = 500; // document lấy mẫu để tìm trường lạ
const DIST = path.join(__dirname, '..', 'dist', 'models');

// ---- schema từ code ---------------------------------------------------------
function loadSchemas() {
  if (!fs.existsSync(DIST)) throw new Error('Chưa build: chạy "npm run build" trước');
  const out = new Map(); // collection -> { name, indexes, paths }
  for (const f of fs.readdirSync(DIST).filter((x) => x.endsWith('.schema.js'))) {
    const mod = require(path.join(DIST, f));
    for (const [name, s] of Object.entries(mod)) {
      if (!name.endsWith('Schema') || !s || typeof s.indexes !== 'function') continue;
      const coll = s.get('collection');
      if (!coll) continue; // subdocument (vd ShareMember)
      const paths = new Set(['_id', '__v', 'createdAt', 'updatedAt']);
      s.eachPath((p) => paths.add(p.split('.')[0]));
      out.set(coll, { name: name.replace(/Schema$/, ''), indexes: s.indexes(), paths });
    }
  }
  return out;
}

const keyOf = (spec) => JSON.stringify(spec);
const fmtKey = (spec) =>
  Object.entries(spec)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

const DEVICE = { inverterdevices: /^GTIControl\d+$/, chargerdevices: /^ChargerControl\d+$/, hybriddevices: /^HybridControl\d+$/ };
// collection con -> collection thiết bị của nó
const CHILDREN = {
  inverterdevices: ['inverterdatas', 'invertersettings', 'inverterschedules', 'dailytotals'],
  chargerdevices: ['chargerdatas', 'chargersettings'],
  hybriddevices: ['hybriddatas', 'hybridsettings', 'hybridenergies'],
};

async function main() {
  const schemas = loadSchemas();
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
  const issues = [];
  const warn = (m) => issues.push(m);

  // ---- 1. collection ----------------------------------------------------------
  console.log('== 1. Collection (document, dữ liệu, index)');
  const existing = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'));
  for (const name of [...new Set([...existing, ...schemas.keys()])].sort()) {
    const inDb = existing.includes(name);
    const inCode = schemas.has(name);
    if (!inDb) {
      console.log(`  ${name.padEnd(28)} (chưa có trên DB — sẽ tạo khi ghi lần đầu)`);
      continue;
    }
    const st = await db.command({ collStats: name }).catch(() => null);
    const line = st
      ? `${String(st.count).padStart(8)} doc  ${mb(st.size).padStart(9)}  index ${mb(st.totalIndexSize)}`
      : '';
    console.log(`  ${name.padEnd(28)} ${line}${inCode ? '' : '   !! KHÔNG CÓ SCHEMA'}`);
    if (!inCode) warn(`Collection "${name}" trên DB không có schema nào dùng (sót lại / tên cũ?)`);
  }

  // ---- 2. index ---------------------------------------------------------------
  console.log('\n== 2. Index');
  for (const [name, sc] of schemas) {
    if (!existing.includes(name)) continue;
    const dbIdx = await db.collection(name).indexes();
    const dbKeys = new Map(dbIdx.map((i) => [keyOf(i.key), i]));
    const want = new Map(sc.indexes.map(([spec, opt]) => [keyOf(spec), { spec, opt: opt || {} }]));
    for (const [k, { spec, opt }] of want) {
      const got = dbKeys.get(k);
      if (!got) {
        warn(`${name}: thiếu index {${fmtKey(spec)}}${opt.unique ? ' unique' : ''} (autoIndex tạo khi app khởi động; thiếu = tạo lỗi, vd dữ liệu trùng)`);
      } else {
        if (opt.unique && !got.unique) warn(`${name}: index {${fmtKey(spec)}} phải unique nhưng DB không unique`);
        if (opt.expireAfterSeconds !== undefined && got.expireAfterSeconds !== opt.expireAfterSeconds) {
          warn(`${name}: TTL {${fmtKey(spec)}} DB=${got.expireAfterSeconds}s, code=${opt.expireAfterSeconds}s`);
        }
      }
    }
    for (const i of dbIdx) {
      const k = keyOf(i.key);
      if (k === keyOf({ _id: 1 }) || want.has(k)) continue;
      // index của @Prop({ index/unique: true }) nằm trong schema.indexes() rồi
      warn(`${name}: index thừa trên DB "${i.name}" {${fmtKey(i.key)}} (code không còn khai báo)`);
    }
  }

  // ---- 3. trường lạ -------------------------------------------------------------
  console.log('\n== 3. Trường không có trong schema (lấy mẫu ' + SAMPLE + ' doc mới nhất)');
  for (const [name, sc] of schemas) {
    if (!existing.includes(name)) continue;
    const counts = new Map();
    const cur = db.collection(name).find({}).sort({ _id: -1 }).limit(SAMPLE);
    for await (const d of cur) {
      for (const k of Object.keys(d)) if (!sc.paths.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const [k, n] of counts) warn(`${name}: trường "${k}" không có trong schema (${n}/${SAMPLE} doc mẫu)`);
  }

  // ---- 4–6. thiết bị ------------------------------------------------------------
  console.log('\n== 4–6. Thiết bị');
  for (const [devColl, children] of Object.entries(CHILDREN)) {
    if (!existing.includes(devColl)) continue;
    const devs = db.collection(devColl);
    const dup = await devs
      .aggregate([{ $group: { _id: { u: '$userId', d: '$deviceId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
      .toArray();
    if (dup.length) warn(`${devColl}: ${dup.length} cặp (userId, deviceId) bị trùng`);
    const multi = await devs
      .aggregate([{ $group: { _id: '$deviceId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
      .toArray();
    const badId = await devs.countDocuments({ deviceId: { $not: DEVICE[devColl] } });
    const total = await devs.estimatedDocumentCount();
    console.log(`  ${devColl}: ${total} dòng, ${multi.length} mã máy thuộc nhiều tài khoản, ${badId} mã sai dạng`);
    if (badId) warn(`${devColl}: ${badId} dòng có deviceId không đúng dạng ${DEVICE[devColl]}`);

    const owned = new Set((await devs.find({}, { projection: { userId: 1, deviceId: 1 } }).toArray()).map((d) => `${d.userId}|${d.deviceId}`));
    for (const ch of children) {
      if (!existing.includes(ch)) continue;
      const pairs = await db
        .collection(ch)
        .aggregate([{ $group: { _id: { u: '$userId', d: '$deviceId' }, n: { $sum: 1 } } }], { allowDiskUse: true })
        .toArray();
      const orphan = pairs.filter((p) => !owned.has(`${p._id.u}|${p._id.d}`));
      const docs = orphan.reduce((s, p) => s + p.n, 0);
      console.log(`    ${ch.padEnd(20)} ${pairs.length} máy, ${orphan.length} máy mồ côi (${docs} doc)`);
      if (orphan.length) warn(`${ch}: ${orphan.length} cặp (userId, deviceId) không còn trong ${devColl} (${docs} doc) — máy đã xoá / đổi chủ`);
    }
  }
  // Máy có mặt ở 2 loại (vd inverter đã chuyển hybrid còn dòng cũ)
  const num = (s) => s.replace(/\D/g, '').replace(/^0+/, '');
  if (existing.includes('inverterdevices') && existing.includes('hybriddevices')) {
    const inv = new Set((await db.collection('inverterdevices').distinct('deviceId')).map(num));
    const hyb = (await db.collection('hybriddevices').distinct('deviceId')).filter((id) => inv.has(num(id)));
    if (hyb.length) console.log(`  Số máy trùng giữa inverter và hybrid (có thể đã chuyển loại): ${hyb.slice(0, 20).join(', ')}${hyb.length > 20 ? '…' : ''}`);
  }

  // ---- tổng kết ---------------------------------------------------------------
  console.log(`\n== Kết luận: ${issues.length} điểm cần xem`);
  for (const m of issues) console.log('  - ' + m);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
