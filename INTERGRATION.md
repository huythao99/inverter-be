# Tích hợp Server & Mobile/Web — Giao tiếp với ESP32 Charger

Tài liệu mô tả **toàn bộ message** mà firmware ESP32 gửi/nhận, để triển khai
backend (MQTT broker + REST API) và app mobile/web.

Firmware dùng **hai kênh**:

| Kênh | Dùng cho |
|---|---|
| **MQTT** | Realtime: telemetry/status device gửi lên, và các *trigger* server đẩy xuống (báo device đi lấy dữ liệu mới, OTA). |
| **HTTP REST** | Device **kéo** (pull) giá trị setting/schedule thật, đăng ký device, báo phiên bản firmware, lấy URL firmware, log lỗi. |

> Điểm quan trọng: server **không** đẩy thẳng giá trị setting/schedule qua MQTT.
> Server chỉ publish một *trigger* rỗng vào `cmd/settings` / `cmd/schedule`, device
> nhận trigger rồi tự gọi REST API để lấy giá trị mới. (Có thêm poll dự phòng 60s.)

---

## 1. Định danh & kết nối

- **MQTT broker**: `giabao-inverter.com:1883`
  - username: `giabao` · password: `0918273645`
  - clientId device: `esp32-<MAC>`
- **REST API base**: `https://giabao-inverter.com`
- **`uid`**: id người dùng (nhập khi cấu hình WiFi cho device).
- **`deviceId`**: chính là SSID AP của device, dạng `ChargerControl<N>` (vd `ChargerControl1369`), cố định theo từng thiết bị.

Mọi topic MQTT theo mẫu:

```
inverter/{uid}/{deviceId}/<phần_topic>
```

Ví dụ: `inverter/user123/ChargerControl1369/data`

---

## 2. Bảng topic MQTT

| Topic (`inverter/{uid}/{deviceId}/...`) | Hướng | QoS | Retain | Ý nghĩa |
|---|---|---|---|---|
| `data`            | **device → server** | 0 | ❌ | Telemetry/cfg/info realtime (1s/lần) |
| `status`          | **device → server** | 0 | ❌ | Heartbeat online (1s/lần) |
| `ota/status`      | **device → server** | 0 | ❌ | Tiến trình cập nhật firmware |
| `cmd/settings`    | **server → device** | 1 | ✅ | Trigger: “setting đã đổi, đi lấy lại” |
| `cmd/schedule`    | **server → device** | 1 | ✅ | Trigger: “lịch đã đổi, đi lấy lại” |
| `firmware/update` | **server → device** | 1 | ✅ (rồi clear) | Trigger: bắt đầu OTA |

> `setup/value` và `schedule/value` device có subscribe nhưng **không xử lý** (giá
> trị thật lấy qua REST). Đừng dựa vào chúng — dùng `cmd/*` + REST.

Khuyến nghị retain: xem thêm `MQTT_RETAIN_NOTES.md`.

---

## 3. Chi tiết payload từng topic

### 3.1 `data` (device → server) — realtime, 1s/lần

Device đẩy nguyên các trường từ khung STM32 (xem `PROTOCOL_MPPT_V1_1.md`). **Mọi
giá trị là chuỗi** (kể cả số) — client tự parse. Có trường `type` để phân loại và
`raw` là khung gốc.

**Telemetry (`type=tlm`)** — thường xuyên nhất:

```json
{
  "type": "tlm",
  "DEV": "MPPT",
  "ST": "RUN",
  "FLT": "0",
  "T": "42.1",
  "MODE": "MPPT",
  "MS": "TRACK",
  "VPV": "60.52",
  "IPV": "8.21",
  "PPV": "497",
  "VBAT": "48.10",
  "IBAT": "9.90",
  "IL": "10.12",
  "DUTY": "0.812",
  "VREF": "60.2",
  "raw": "$TLM,DEV=MPPT,ST=RUN,...*E9"
}
```

Ý nghĩa các trường (tóm tắt — chi tiết ở `PROTOCOL_MPPT_V1_1.md` §5):

| Trường | Đơn vị | Ghi chú |
|---|---|---|
| `ST` | — | `RUN` chạy · `IDLE` chờ PV · `OFF` đang ở menu máy · `CAL` hiệu chuẩn · `FLT` lỗi |
| `FLT` | — | `0` không lỗi · `1` lỗi phần cứng |
| `T` | °C | Nhiệt độ tản nhiệt |
| `MODE` | — | `MPPT`/`CV`/`CC` (chỉ có nghĩa khi `ST=RUN`) |
| `MS` | — | `WAIT`/`SCAN`/`TRACK`/`LIM` |
| `VPV`/`IPV`/`PPV` | V/A/W | Thông số tấm pin |
| `VBAT`/`IBAT` | V/A | Ắc quy (đang đo, khác giá trị cài đặt) |
| `IL` | A | Dòng cuộn cảm |
| `DUTY` | 0–1 | Duty PWM |
| `VREF` | V | Điện áp PV mục tiêu |

> Dòng điện có thể hơi âm do nhiễu khi không tải → khi hiển thị nên kẹp về ≥ 0.
> Giá trị không hợp lệ (hiếm) gửi là `NAN`.

**Config hiện tại (`type=cfg`)** — gửi khi khởi động và **mỗi khi người dùng đổi
tham số bằng phím trên máy** (hoặc sau SET thành công):

```json
{ "type": "cfg", "VBAT": "54.0", "IBAT": "20.0", "PBAT": "500", "SRC": "ESP", "raw": "$CFG,...*43" }
```

- `VBAT` (V): điện áp sạc (CV) · `IBAT` (A): dòng sạc tối đa (CC) · `PBAT` (W): công suất (lưu/hiển thị)
- `SRC`: `ESP` (nhận điều khiển từ cloud) hoặc `LOCAL` (chỉ chỉnh trên máy). **Xem mục 6.**

**Thông tin thiết bị (`type=info`)** — gửi lúc device kết nối STM32:

```json
{ "type": "info", "DEV": "MPPT", "PROTO": "1", "FW": "1.0.0", "HW": "F303CB", "raw": "$INFO,...*6F" }
```

### 3.2 `status` (device → server) — heartbeat 1s/lần

```json
{ "updatedAt": "2026-09-19T10:20:30Z", "status": "online" }
```

Không có LWT trong firmware → server suy ra **offline** khi ngừng nhận `status`
(vd quá 5–10s không có message).

### 3.3 `ota/status` (device → server)

```json
{ "status": "downloading", "message": "Downloading firmware", "progress": 40, "timestamp": "2026-09-19T10:21:00Z" }
```

- `status`: `starting` → `downloading` (kèm `progress` 0–100, mỗi ~10%) → `installing` → `success` | `failed`
- `message`, `progress`, `timestamp` là tùy chọn (có thể vắng).

### 3.4 `cmd/settings` / `cmd/schedule` (server → device)

Payload **không quan trọng** (device chỉ phản ứng với tên topic). Nên gửi `{}`.

```jsonc
// Publish khi setting/schedule của device thay đổi:
topic:   inverter/{uid}/{deviceId}/cmd/settings   payload: {}   qos:1 retain:true
topic:   inverter/{uid}/{deviceId}/cmd/schedule   payload: {}   qos:1 retain:true
```

Device nhận → gọi REST GET tương ứng (mục 4) để lấy giá trị mới. Retain=true để
device vừa online lại là đồng bộ ngay.

### 3.5 `firmware/update` (server → device) — trigger OTA

```jsonc
topic: inverter/{uid}/{deviceId}/firmware/update   payload: {} (hoặc rỗng)   qos:1 retain:true
```

Device nhận bất kỳ message nào trên topic này → bắt đầu OTA: gọi `GET /api/firmware`
để lấy URL, tải và cập nhật, đồng thời báo tiến trình qua `ota/status`.

> **Bắt buộc dùng pattern publish → clear**: sau khi thấy `ota/status.status = "success"`
> (hoặc timeout), server phải publish payload rỗng `""` (retain=true) lên chính topic
> này để **xóa retained message**, nếu không device reboot xong sẽ nhận lại và OTA vô tận.
> Xem `MQTT_RETAIN_NOTES.md`.

---

## 4. HTTP REST API (server phải cung cấp)

Device gọi các endpoint sau (base `https://giabao-inverter.com`):

### 4.1 Lấy setting — `GET /api/inverter-setting/data/{uid}/{deviceId}?source=hardware`

Trả:
```json
{ "value": "05400200" }
```
`value` là **chuỗi 8 chữ số `HHHHLLLL`** (xem mục 5). Device tự map sang `VBAT`/`IBAT`
và gửi xuống STM32.

### 4.2 Lấy lịch — `GET /api/inverter-schedule/data/{uid}/{deviceId}?source=hardware`

Trả:
```json
{ "schedule": "start=23:10&end=34:00&value=05400200#start=10:00&end=10:45&value=05500150" }
```
Chuỗi lịch: xem mục 5. Tối đa 10 mục, phân tách bằng `#`.

### 4.3 Đăng ký device — `POST /api/inverter-device/data`

Body:
```json
{ "deviceId": "ChargerControl1369", "deviceName": "ChargerControl1369", "userId": "{uid}", "firmwareVersion": "1.0.11" }
```
Trả 200/201 là thành công. (Device gọi khi lần đầu online.)

### 4.4 Báo phiên bản firmware — `PATCH /api/inverter-device/data/{uid}/{deviceId}/firmware`

Body:
```json
{ "firmwareVersion": "1.0.11" }
```

### 4.5 Lấy URL firmware (OTA) — `GET /api/firmware?deviceId={deviceId}`

Trả:
```json
{ "url": "https://.../firmware.bin" }
```
Chấp nhận cả `url` hoặc `downloadUrl`. Có thể là presigned S3/CloudFront (device
tự follow redirect).

### 4.6 Log lỗi — `POST /api/track-log-error`

Body:
```json
{ "userId": "{uid}", "deviceId": "ChargerControl1369", "errorCode": "STM_OFFLINE", "errorMessage": "No $TLM from STM32 for >3s" }
```
Device gửi các mã như `STM_OFFLINE`, `STM_SET_LOCAL`, `STM_SET_RANGE`, `STM_TIMEOUT`,
`STM_SRC_LOCAL`, `MQTT_FAILED`, `FOTA_FAILED`, ... (rate-limited).

---

## 5. Định dạng giá trị

### 5.1 Setting value — chuỗi 8 chữ số `HHHHLLLL`

- `HHHH` = **VBAT** theo **phần chục volt** (tenths of a volt)
- `LLLL` = **IBAT** theo **phần chục ampe** (tenths of an amp)

| `value` | VBAT | IBAT |
|---|---|---|
| `05400200` | 54.0 V | 20.0 A |
| `04800100` | 48.0 V | 10.0 A |
| `10000999` | 100.0 V | 99.9 A |

Công thức: `HHHH = round(VBAT * 10)`, `LLLL = round(IBAT * 10)`, mỗi phần **4 chữ số,
zero-pad**. Dải hợp lệ của STM32: VBAT 3.0–100.0 V, IBAT 0.0–100.0 A (ngoài dải sẽ bị
STM32 từ chối → device log `STM_SET_RANGE`).

### 5.2 Schedule string

```
start=HH:MM&end=HH:MM&value=HHHHLLLL[#start=...&end=...&value=...]...
```

- Mỗi mục: `start`, `end` (giờ 24h), `value` (định dạng 8 chữ số như trên).
- Phân tách nhiều mục bằng `#`, tối đa **10** mục.
- Lịch **qua đêm**: cho `end` vượt 24h, vd `end=34:00` nghĩa là 10:00 sáng hôm sau
  (device tự quy về `10:00`). Hoặc đặt `end < start` cũng hiểu là qua đêm.
- Khi nhiều mục trùng thời điểm → **mục đầu tiên (index nhỏ) thắng**.
- Ưu tiên áp dụng: **schedule > setting**. Nếu không có lịch nào khớp giờ hiện tại,
  device dùng setting cơ bản (4.1).

> Device cần đồng bộ thời gian qua NTP để chạy schedule; nếu chưa sync sẽ tạm bỏ qua lịch.

---

## 6. Điều kiện áp dụng lệnh (quan trọng cho mobile/web)

STM32 **chỉ nhận SET (đổi VBAT/IBAT) khi `SRC=ESP`**. Người dùng phải chọn
“Nguồn = ESP32” trong menu trên máy sạc.

- Nếu `SRC=LOCAL` (thấy trong `data type=cfg`), device sẽ **không gửi** setting và
  log `STM_SRC_LOCAL`. → App nên hiển thị nhắc: *“Hãy chọn nguồn ESP32 trên máy để
  điều khiển từ xa.”*
- Nếu người dùng đang thao tác menu trên máy (`ST=OFF`/`CAL`), STM32 báo bận → device
  tự thử lại sau vài giây.
- App nên coi trạng thái “đã áp dụng” dựa trên `type=cfg` phản hồi (giá trị `VBAT`/`IBAT`
  thực tế trên máy), không chỉ dựa trên lệnh đã gửi.

---

## 7. Luồng điển hình

### 7.1 Người dùng đổi setting trên app

```
App/Web  → BE: lưu value mới (HHHHLLLL) vào DB
BE       → MQTT publish  inverter/{uid}/{deviceId}/cmd/settings  {}  (retain,qos1)
Device   ← nhận trigger → GET /api/inverter-setting/data/{uid}/{deviceId}?source=hardware
Device   → STM32: $SET,VBAT=..,IBAT=..  (nếu SRC=ESP)
Device   → MQTT data (type=cfg) phản hồi giá trị mới  → App cập nhật UI
```

### 7.2 Đổi lịch: giống 7.1 nhưng dùng `cmd/schedule` + `/api/inverter-schedule/...`.

### 7.3 Xem realtime

```
Device → MQTT data (type=tlm) mỗi 1s  → App/Web subscribe & hiển thị
Device → MQTT status mỗi 1s           → App/Web hiển thị online/offline
```

### 7.4 OTA

```
BE     → MQTT publish firmware/update {} (retain,qos1)
Device ← trigger → GET /api/firmware?deviceId=... → tải & cập nhật
Device → MQTT ota/status: starting → downloading(%) → installing → success
BE     → sau "success": clear retained (publish "" retain=true lên firmware/update)
Device → reboot, PATCH .../firmware báo version mới
```

---

## 8. Checklist triển khai Server

- [ ] MQTT broker cho phép user `giabao`, cấp quyền publish/subscribe trên `inverter/#`.
- [ ] Publish `cmd/settings` / `cmd/schedule` (retain, qos1) mỗi khi dữ liệu đổi.
- [ ] REST: 6 endpoint ở mục 4 (đúng path, đúng field JSON).
- [ ] OTA: publish `firmware/update` rồi **clear** sau khi nhận `ota/status=success`.
- [ ] Subscribe `data`, `status`, `ota/status` để lưu/hiển thị; suy ra offline khi mất `status`.

## 9. Checklist triển khai Mobile/Web

- [ ] Subscribe `data` (parse `type` = tlm/cfg/info; mọi value là string), `status`, `ota/status`.
- [ ] Gửi setting/schedule qua **BE REST**, rồi để BE bắn `cmd/*` (client không tự publish `cmd/*` trừ khi được cấp quyền).
- [ ] Hiển thị cảnh báo khi `cfg.SRC = LOCAL` (mục 6).
- [ ] Coi giá trị áp dụng thật = `data type=cfg`, không chỉ lệnh đã gửi.
