# Cơ sở dữ liệu (MongoDB)

Tên collection được ghi cố định trong từng schema (`@Schema({ collection })`),
`src/models/schemas.spec.ts` khoá danh sách này: đổi tên một collection là
production bắt đầu từ một collection rỗng, phải có script chuyển dữ liệu.

Khoá chung của dữ liệu thiết bị: cặp `(userId, deviceId)` — `userId` là uid
Firebase của chủ máy, `deviceId` là SSID AP (`GTIControl1230`,
`ChargerControl1369`, `HybridControl0015`). Một mã máy có thể có nhiều dòng
(nhiều chủ) ở hybrid khi `HYBRID_EXCLUSIVE_OWNER` tắt.

## Thiết bị: một bảng `devices`, phân loại bằng `kind`

| `kind` | Model (discriminator) | Mã mặc định | Trường riêng |
|---|---|---|---|
| `inverter` | `InverterDevice` | `GTIControl<N>` | `StmDeviceBase` + `autoCalculate`, `stmProtocol` |
| `charger` | `ChargerDevice` | `ChargerControl<N>` | — |
| `hybrid` | `HybridDevice` | `HybridControl<N>` | `StmDeviceBase` |

- Model gốc `Device` (`src/models/device.schema.ts`), `discriminatorKey: 'kind'`.
  Ba model con là Mongoose discriminator, đăng ký MỘT lần trong
  `DevicesModule` (global). Truy vấn qua model con tự thêm `kind`, document
  tạo qua model con tự có `kind`, nên service vẫn dùng model theo loại.
- Truy vấn không phân loại (mã máy này loại gì, mọi máy của một người):
  `DevicesService` (`owners`, `kindOf`, `listByUser`).
- Loại máy lấy từ `kind`, không đoán theo tiền tố mã máy (máy theo hãng có
  thể dùng tiền tố riêng).
- Index: unique `(userId, deviceId)` trên mọi loại, và `(deviceId)`.
- Trường chung: `src/models/device-base.schema.ts`
  - `DeviceBase`: `userId`, `deviceId`, `deviceName`, `firmwareVersion` (ESP32), `description`, `updatedAt`
  - `StmDeviceBase` (máy có mạch STM32 nạp qua ESP32): `stmFwVersion`, `stmFwCrc`, `stmInfoAt`, `stmOta`
- 3 bảng cũ `inverterdevices`, `chargerdevices`, `hybriddevices`: không còn
  dùng sau `scripts/migrate-devices.js --apply`, giữ làm bản sao lưu
  (`--rollback` chép ngược về khi cần quay lại backend cũ).

## Dữ liệu, cài đặt, điện năng

| Loại | Inverter | Bộ sạc | Hybrid |
|---|---|---|---|
| Dữ liệu mới nhất | `inverterdatas` (chuỗi `value`) | `chargerdatas` | `hybriddatas` ($TLM/$CFG/$INFO/$ADV, NAK, ETOT) |
| Cài đặt | `invertersettings`, `inverterschedules` | `chargersettings` | `hybridsettings` (config + yêu cầu đang chờ) |
| Điện năng | `dailytotals` (đồng hồ đo, theo ngày) | — | `hybridenergies` (4 bộ đếm theo ngày) |

## Firmware

| Collection | Nội dung |
|---|---|
| `esp_firmwares` | Bản ESP32 (inverter / sạc / hybrid, stable / beta) |
| `stm_firmwares` | Ảnh STM32 theo sản phẩm, chip, mức điện áp |
| `firmware_rollouts`, `firmware_rollout_devices` | Cập nhật hàng loạt |
| `betafirmwaredevices` | Thiết bị nhận bản beta |
| `spaces_pending_deletes` | File trên Spaces chờ xoá lại |

## Tài khoản, quyền, chia sẻ

| Collection | Nội dung |
|---|---|
| `admins` | Tài khoản CMS (bcrypt) |
| `mqttcredentials` | Tài khoản broker: `charger`, `hybrid` (từng máy), `app`, `cms`, `ha` |
| `chargerclaims` | Mã claim một lần khi thêm bộ sạc (TTL) |
| `blacklistdevices` | Thiết bị bị khoá |
| `device_viewers`, `device_share_links` | Chia sẻ **quyền xem** máy cho người khác / link công khai |
| `sharegroups` | Chia sẻ **công suất** giữa các inverter |

## Log

| Collection | Giữ |
|---|---|
| `audit_logs` | 365 ngày (TTL) |
| `tracklogerrors` | 7 ngày (TTL) — log lỗi từ thiết bị |
| `device_health` | Tình trạng kết nối thiết bị |

## Dọn dữ liệu / chuyển dữ liệu

- `scripts/migrate-devices.js`: gộp 3 bảng thiết bị vào `devices` (xem thứ tự deploy trong file).
- `scripts/db-audit.js`: so database thật với schema (chỉ đọc).

- `scripts/cleanup-dead-fields.js`: xoá trường của tính năng chuyển hybrid ↔ inverter đã bỏ
  (`inverterdevices.hybridConversion`, `hybriddevices.convertedFrom`, `hybriddevices.inverterConversion`).
- `scripts/restore-hybrid-owners.js`: dựng lại máy hybrid bị mất khỏi danh sách chủ.
