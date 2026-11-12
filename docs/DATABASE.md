# Cơ sở dữ liệu (MongoDB)

Tên collection được ghi cố định trong từng schema (`@Schema({ collection })`),
`src/models/schemas.spec.ts` khoá danh sách này: đổi tên một collection là
production bắt đầu từ một collection rỗng, phải có script chuyển dữ liệu.

Khoá chung của dữ liệu thiết bị: cặp `(userId, deviceId)` — `userId` là uid
Firebase của chủ máy, `deviceId` là SSID AP (`GTIControl1230`,
`ChargerControl1369`, `HybridControl0015`). Một mã máy có thể có nhiều dòng
(nhiều chủ) ở hybrid khi `HYBRID_EXCLUSIVE_OWNER` tắt.

## Thiết bị

| Collection | Schema | Ghi chú |
|---|---|---|
| `inverterdevices` | `InverterDevice` | `StmDeviceBase` + `autoCalculate`, `stmProtocol` |
| `chargerdevices` | `ChargerDevice` | `DeviceBase` |
| `hybriddevices` | `HybridDevice` | `StmDeviceBase` |

Trường chung nằm ở `src/models/device-base.schema.ts`:
- `DeviceBase`: `userId`, `deviceId`, `deviceName`, `firmwareVersion` (ESP32), `description`, `updatedAt`
- `StmDeviceBase` (máy có mạch STM32 nạp qua ESP32): `stmFwVersion`, `stmFwCrc`, `stmInfoAt`, `stmOta`

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

## Dọn dữ liệu

- `scripts/cleanup-dead-fields.js`: xoá trường của tính năng chuyển hybrid ↔ inverter đã bỏ
  (`inverterdevices.hybridConversion`, `hybriddevices.convertedFrom`, `hybriddevices.inverterConversion`).
- `scripts/restore-hybrid-owners.js`: dựng lại máy hybrid bị mất khỏi danh sách chủ.
