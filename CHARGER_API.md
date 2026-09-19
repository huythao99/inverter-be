# Charger API & MQTT — phân theo phía sử dụng

Tài liệu liệt kê **API REST**, **MQTT topic** và **WebSocket** cho thiết bị Charger,
tách theo 3 phía: **ESP32 (firmware)**, **Mobile app**, **Web**.

> Charger là firmware **tách biệt** khỏi inverter:
> - REST prefix: `/api/charger-*`
> - MQTT namespace: `charger/{uid}/{deviceId}/...`
>
> - `uid` = id người dùng · `deviceId` = SSID AP của máy, dạng `ChargerControl<N>`.
> - Base REST: `https://giabao-inverter.com`
> - MQTT broker: `giabao-inverter.com:1883`

Ký hiệu cột: ✅ = có dùng · — = không dùng.

---

## 1. Tổng quan nhanh (ai dùng gì)

| Thành phần | ESP32 | Mobile | Web |
|---|:---:|:---:|:---:|
| MQTT publish `data` / `status` / `ota/status` | ✅ | — | — |
| MQTT subscribe `cmd/settings` / `cmd/schedule` / `firmware/update` | ✅ | — | — |
| REST `/api/charger-device` (đăng ký, báo firmware) | ✅ | — | — |
| REST `/api/charger-setting` (GET `?source=hardware`) | ✅ | — | — |
| REST `/api/charger-schedule` (GET) | ✅ | — | — |
| REST `/api/charger-firmware` (GET url) | ✅ | — | — |
| REST `/api/charger-setting` (ghi VBAT/IBAT) | — | ✅ | ✅ |
| REST `/api/charger-schedule` (ghi lịch) | — | ✅ | ✅ |
| REST `/api/charger` (`/latest` realtime snapshot) | — | ✅ | ✅ |
| REST `/api/charger-device/data/device/:userId` (danh sách của user) | — | ✅ | ✅ |
| WebSocket `/cms` (`chargerData`/`chargerStatus`/`chargerOtaStatus`) | — | ✅ | ✅ |
| REST `/api/charger-device/data` (danh sách toàn bộ, phân trang) | — | — | ✅ (admin) |
| REST `/api/charger-firmware/update/...` (kích hoạt OTA) | — | ⚠️ | ✅ (admin) |
| REST xóa (`DELETE ...`) | — | — | ✅ (admin) |

> ⚠️ OTA có thể để riêng cho admin/web; mobile chỉ nên **xem tiến trình** OTA.
> Mobile và Web (bản người dùng cuối) dùng **chung** bộ API app-facing bên dưới.

---

## 2. Phần dùng cho ESP32 (firmware)

### 2.1 MQTT — device gửi lên (publish)

```
charger/{uid}/{deviceId}/data          # telemetry/cfg/info, JSON có "type"
charger/{uid}/{deviceId}/status        # heartbeat { "status": "online" }
charger/{uid}/{deviceId}/ota/status    # tiến trình OTA
```

Payload `data` (mọi value là **chuỗi**):

```jsonc
// type=tlm (realtime)
{ "type":"tlm","DEV":"MPPT","ST":"RUN","FLT":"0","T":"42.1","MODE":"MPPT",
  "MS":"TRACK","VPV":"60.52","IPV":"8.21","PPV":"497","VBAT":"48.10",
  "IBAT":"9.90","IL":"10.12","DUTY":"0.812","VREF":"60.2","raw":"$TLM,...*E9" }

// type=cfg (giá trị thực đang áp dụng trên máy)
{ "type":"cfg","VBAT":"54.0","IBAT":"20.0","PBAT":"500","SRC":"ESP","raw":"$CFG,...*43" }

// type=info (lúc kết nối STM32)
{ "type":"info","DEV":"MPPT","PROTO":"1","FW":"1.0.0","HW":"F303CB","raw":"$INFO,...*6F" }
```

`ota/status`:
```json
{ "status":"downloading", "message":"...", "progress":40, "timestamp":"..." }
```
`status` chuỗi: `starting → downloading(%) → installing → success|failed`.

### 2.2 MQTT — device nhận về (subscribe)

```
charger/{uid}/{deviceId}/cmd/settings    # trigger: đi GET lại setting
charger/{uid}/{deviceId}/cmd/schedule    # trigger: đi GET lại lịch
charger/{uid}/{deviceId}/firmware/update # trigger: bắt đầu OTA
```
Payload không quan trọng (device chỉ phản ứng với tên topic). Server publish
retain=true, qos=1. Sau OTA `success`/`failed`, server **tự clear** retained của
`firmware/update`.

### 2.3 REST — device gọi

| Method | Path | Body / Query | Trả về |
|---|---|---|---|
| POST | `/api/charger-device/data` | `{deviceId, deviceName, userId, firmwareVersion}` | 201 |
| PATCH | `/api/charger-device/data/{uid}/{deviceId}/firmware` | `{firmwareVersion}` | device |
| GET | `/api/charger-setting/data/{uid}/{deviceId}?source=hardware` | — | `{ "value": "05400200" }` |
| GET | `/api/charger-schedule/data/{uid}/{deviceId}?source=hardware` | — | `{ "schedule": "start=..&end=..&value=.." }` |
| GET | `/api/charger-firmware?deviceId={deviceId}` | — | `{ "url": "https://.../firmware.bin" }` |

> `value` = chuỗi 8 số `HHHHLLLL`: `HHHH = VBAT×10`, `LLLL = IBAT×10`.
> Dải hợp lệ STM32: VBAT 3.0–100.0 V, IBAT 0.0–100.0 A.

---

## 3. Phần dùng cho Mobile (app người dùng cuối)

> Base REST như trên. WebSocket cần JWT.

### 3.1 REST

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/charger-device/data/device/{uid}` | Danh sách charger của user |
| GET | `/api/charger-device/data/{uid}/{deviceId}` | Chi tiết 1 charger |
| GET | `/api/charger/data/{uid}/{deviceId}/latest` | Snapshot realtime mới nhất |
| GET | `/api/charger-setting/data/{uid}/{deviceId}` | Đọc setting (kèm `vbat`/`ibat` đã decode) |
| PATCH | `/api/charger-setting/data/{uid}/{deviceId}` | Ghi setting thân thiện `{ "vbat":54.0, "ibat":20.0 }` |
| PATCH | `/api/charger-setting/data/{uid}/{deviceId}/value` | Ghi setting raw `{ "value":"05400200" }` |
| GET | `/api/charger-schedule/data/{uid}/{deviceId}` | Đọc lịch |
| PATCH | `/api/charger-schedule/data/{uid}/{deviceId}/schedule` | Ghi lịch `{ "schedule":"start=..&end=..&value=.." }` |
| PATCH | `/api/charger-device/data/{uid}/{deviceId}/description` | Đổi tên/ghi chú |
| GET | `/api/charger-firmware/version?userId={uid}&deviceId={deviceId}` | Version hiện tại |
| GET | `/api/charger-firmware/newest` | Version mới nhất (để so sánh, gợi ý update) |

Khi PATCH setting/schedule, backend **tự** publish `cmd/settings` / `cmd/schedule`
(retain, qos1) → device tự đi lấy giá trị mới.

`GET /latest` trả (rút gọn):
```jsonc
{
  "userId":"...", "deviceId":"ChargerControl1369",
  "status":"online",                 // online/offline suy ra từ heartbeat
  "st":"RUN","mode":"MPPT","ms":"TRACK","temp":"42.1",
  "vpv":"60.52","ipv":"8.21","ppv":"497",
  "vbat":"48.10","ibat":"9.90","il":"10.12","duty":"0.812","vref":"60.2",
  "cfgVbat":"54.0","cfgIbat":"20.0","cfgPbat":"500","src":"ESP", // giá trị đang áp dụng
  "fw":"1.0.0","hw":"F303CB","raw":"..."
}
```

### 3.2 WebSocket realtime — namespace `/cms`

Kết nối kèm JWT (`auth.token` hoặc header `Authorization: Bearer ...`).

```js
socket.emit('subscribe',   { userId, deviceId });
socket.emit('unsubscribe', { userId, deviceId });

socket.on('chargerData',      d => {}); // telemetry/cfg/info mỗi lần device gửi
socket.on('chargerStatus',    d => {}); // { status: "online" }
socket.on('chargerOtaStatus', d => {}); // tiến trình OTA
```

### 3.3 Lưu ý bắt buộc (mục 6 INTERGRATION.md)
- Coi giá trị **đã áp dụng thật** = `cfgVbat`/`cfgIbat` (từ `type=cfg`), không chỉ lệnh đã gửi.
- Nếu `src = "LOCAL"` → hiển thị: *"Hãy chọn nguồn ESP32 trên máy để điều khiển từ xa."*
- Dòng điện có thể hơi âm khi không tải → kẹp về ≥ 0 khi hiển thị. Giá trị lỗi = `NAN`.

---

## 4. Phần dùng cho Web

Web bản **người dùng cuối**: dùng **y hệt** bộ API + WebSocket ở mục 3 (Mobile).

Web bản **quản trị/CMS** dùng thêm:

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/charger-device/data?page=&limit=` | Danh sách toàn bộ charger (phân trang) |
| GET | `/api/charger/data?page=&limit=` | Danh sách snapshot realtime toàn bộ |
| GET | `/api/charger-device/data/{id}` | Chi tiết theo `_id` |
| POST | `/api/charger-firmware/update/{uid}/{deviceId}` | Kích hoạt OTA `{ "targetVersion":"1.0.1" }` |
| PATCH | `/api/charger-device/data/{uid}/{deviceId}` | Sửa metadata thiết bị |
| DELETE | `/api/charger-device/data/{uid}/{deviceId}` \| `/data/{id}` | Xóa thiết bị |
| DELETE | `/api/charger-setting/data`, `/api/charger-schedule/data`, `/api/charger/data` | Dọn dữ liệu |

WebSocket giống mục 3.2 (`chargerData`/`chargerStatus`/`chargerOtaStatus`).

---

## 5. Định dạng giá trị (dùng chung)

### 5.1 Setting `HHHHLLLL`
`HHHH = round(VBAT×10)`, `LLLL = round(IBAT×10)`, mỗi phần 4 số zero-pad.

| value | VBAT | IBAT |
|---|---|---|
| `05400200` | 54.0 V | 20.0 A |
| `04800100` | 48.0 V | 10.0 A |
| `10000999` | 100.0 V | 99.9 A |

### 5.2 Schedule
```
start=HH:MM&end=HH:MM&value=HHHHLLLL[#start=...&end=...&value=...]...
```
Tối đa 10 mục (`#`). Qua đêm: `end` vượt 24h (vd `end=34:00`) hoặc `end < start`.
Trùng giờ → mục index nhỏ thắng. Ưu tiên: **schedule > setting**.
