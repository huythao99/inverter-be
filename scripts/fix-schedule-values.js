#!/usr/bin/env node
/**
 * Sửa giá trị lịch xả bị lưu sai (không đủ 8 chữ số, vd "01000" do app cũ gửi
 * ô bỏ trống) bằng cài đặt của chính thiết bị đó — giống cách app mới điền ô
 * trống. Dùng đúng hàm của backend (dist/utils/schedule-value.js).
 *
 *   npm run build
 *   node scripts/fix-schedule-values.js            # chạy thử: chỉ liệt kê
 *   node scripts/fix-schedule-values.js --apply    # ghi vào DB
 *
 * Không cần dừng backend. Thiết bị lấy lịch mới ở lần tải lịch tiếp theo; từ
 * bản backend này thiết bị cũng nhận bản đã sửa ngay cả khi DB chưa sửa.
 * Đọc MONGODB_URI / MONGODB_USERNAME / MONGODB_PASSWORD / MONGODB_DATABASE từ .env.
 */
require('dotenv').config();
const path = require('path');
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
let repairSchedule;
try {
  ({ repairSchedule } = require(path.join(__dirname, '..', 'dist', 'utils', 'schedule-value.js')));
} catch {
  console.error('Chưa build: chạy "npm run build" trước');
  process.exit(1);
}

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
  try {
    const schedules = db.collection('inverterschedules');
    const settings = db.collection('invertersettings');
    // Chỉ những lịch có ít nhất một value không đủ 8 chữ số.
    const bad = await schedules
      .find({ schedule: { $regex: 'value=(?!\\d{8}(?:[&#]|$))' } }, { projection: { userId: 1, deviceId: 1, schedule: 1 } })
      .toArray();
    let fixed = 0;
    let stuck = 0;
    for (const doc of bad) {
      const set = await settings.findOne({ userId: doc.userId, deviceId: doc.deviceId }, { projection: { value: 1 } });
      const r = repairSchedule(doc.schedule, set && set.value);
      const tag = `${doc.userId}|${doc.deviceId}`;
      if (r.fixed === 0) {
        stuck++;
        console.log(`  !! ${tag}: không sửa được (chưa có cài đặt hợp lệ: ${set ? set.value : 'không có'})`);
        continue;
      }
      fixed++;
      console.log(`  ${tag}: ${r.fixed} khung giờ (cài đặt ${set.value})${r.invalid ? `, còn ${r.invalid} khung lỗi` : ''}`);
      if (APPLY) {
        await schedules.updateOne(
          { _id: doc._id, schedule: doc.schedule },
          { $set: { schedule: r.schedule, updatedAt: new Date() } },
        );
      }
    }
    console.log(
      `\n${bad.length} lịch có giá trị sai: ${fixed} sửa được, ${stuck} không sửa được.` +
        (APPLY ? ' Đã ghi vào DB.' : ' Chạy thử, thêm --apply để ghi.'),
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
