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
| MQTT subscribe `cmd/settings` / `firmware/update` | ✅ | — | — |
| REST `/api/charger-device` (đăng ký, báo firmware) | ✅ | — | — |
| REST `/api/charger-setting` (GET `?source=hardware`) | ✅ | — | — |
| REST `/api/charger-firmware` (GET url) | ✅ | — | — |
| REST `/api/charger-*` (list, `/latest`, đọc/ghi setting — **uid trên URL, không guard**) | — | ✅ | — |
| REST `/api/user/chargers/*` (list, `/latest`, đọc/ghi setting — **Firebase JWT**) | — | — | ✅ |
| MQTT nghe broker trực tiếp (`charger/{uid}/{deviceId}/data`, `ota/status`) | — | ✅ | ✅ |
| REST `/api/cms/charger/*` (dashboard, list, details, sửa/xóa, OTA — **JWT admin**) | — | — | ✅ (admin) |

> **Mobile**: bộ `/api/charger-*` (uid trên URL, không Firebase). **Web người dùng cuối**:
> bộ `/api/user/chargers/*` (Firebase JWT, giống inverter `/api/user/*`). Cả hai nghe
> MQTT broker trực tiếp cho realtime.

---

## 2. Phần dùng cho ESP32 (firmware)

### 2.1 MQTT — device gửi lên (publish)

```
charger/{uid}/{deviceId}/data          # khung STM32 RAW (chuỗi $...*CRC), không phải JSON
charger/{uid}/{deviceId}/status        # heartbeat { "status": "online" }
charger/{uid}/{deviceId}/ota/status    # tiến trình OTA
```

**Payload `data` là CHUỖI RAW nguyên khung STM32** (`$<TYPE>,<KEY=VALUE>...*<CRC>`),
đúng như nhận trên UART — **không bọc JSON**. Backend/WebSocket tự parse: tách theo
`,`, mỗi item là `KEY=VALUE`; `TYPE` (token đầu sau `$`) cho biết loại. Xem đầy đủ
danh sách trường ở `PROTOCOL_MPPT_V1_1.md` (§5 TLM, §6 CFG, §4 INFO).

```
# TLM (realtime, ~1s/lần; gửi ngay khi ST/FLT đổi)
$TLM,DEV=MPPT,ST=RUN,FLT=0,LOCK=0,RTRY=0,OUT=BAT,T=42.1,MODE=MPPT,MS=TRACK,VPV=60.52,IPV=8.21,PPV=497,VBAT=48.10,IBAT=9.90,IL=10.12,DUTY=0.812,VREF=60.2*4E

# CFG (giá trị thực đang áp dụng trên máy)
$CFG,VBAT=54.0,IBAT=20.0,PBAT=500,SRC=ESP,OUT=BAT*1D

# INFO (lúc kết nối STM32)
$INFO,DEV=MPPT,PROTO=1,FW=1.0.0,HW=F303CB*6F
```

Gợi ý parse phía server (JS):
```js
function parseFrame(raw) {              // "$TLM,DEV=MPPT,ST=RUN,...*4E"
  const body = raw.slice(1, raw.lastIndexOf('*')); // bỏ '$' và '*CRC'
  const [type, ...items] = body.split(',');
  const kv = Object.fromEntries(items.map(i => i.split('=')));
  return { type, ...kv };               // { type:"TLM", DEV:"MPPT", ST:"RUN", ... }
}
```

> Mọi value là **chuỗi**. Dòng điện có thể hơi âm → kẹp ≥ 0 khi hiển thị; giá trị lỗi = `NAN`.

`ota/status`:
```json
{ "status":"downloading", "message":"...", "progress":40, "timestamp":"..." }
```
`status` chuỗi: `starting → downloading(%) → installing → success|failed`.

### 2.2 MQTT — device nhận về (subscribe)

```
charger/{uid}/{deviceId}/cmd/settings    # trigger: đi GET lại setting
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
| GET | `/api/charger-firmware?deviceId={deviceId}` | — | `{ "url": "https://.../firmware.bin" }` |

> `value` = chuỗi 8 số `HHHHLLLL`: `HHHH = VBAT×10`, `LLLL = IBAT×10`.
> Dải hợp lệ STM32: VBAT 3.0–100.0 V, IBAT 0.0–100.0 A.

---

## 3. Phần dùng cho Mobile (app người dùng cuối)

> **KHÔNG dùng Firebase auth.** Mobile gọi thẳng bộ `/api/charger-*` với `uid`
> truyền trên URL. Realtime: nghe MQTT broker trực tiếp (mục 3.2).

### 3.1 REST — `/api/charger-*` (uid trên URL, không guard)

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/charger-device/data/device/{uid}` | Danh sách charger của user |
| GET | `/api/charger-device/data/{uid}/{deviceId}` | Chi tiết 1 charger |
| GET | `/api/charger/data/{uid}/{deviceId}/latest` | Snapshot realtime (kèm `status` online/offline) |
| GET | `/api/charger-setting/data/{uid}/{deviceId}` | Đọc setting (kèm `vbat`/`ibat` đã decode) |
| PATCH | `/api/charger-setting/data/{uid}/{deviceId}` | Ghi setting thân thiện `{ "vbat":54.0, "ibat":20.0 }` |
| PATCH | `/api/charger-setting/data/{uid}/{deviceId}/value` | Ghi setting raw `{ "value":"05400200" }` |
| PATCH | `/api/charger-device/data/{uid}/{deviceId}/description` | Đổi ghi chú |
| GET | `/api/charger-firmware/version?userId={uid}&deviceId={deviceId}` | Version hiện tại |
| GET | `/api/charger-firmware/newest` | Version mới nhất (gợi ý update) |

Khi PATCH setting, backend **tự** publish `cmd/settings` (retain, qos1) → device
tự đi lấy giá trị mới.

> Thiết bị chỉ bắn **chuỗi raw** lên topic `data` (mục 2.1). **Backend là nơi parse
> khung raw** và dựng snapshot đã giải mã dưới đây cho mobile/web.

`GET /latest` trả (rút gọn, do backend giải mã từ raw):
```jsonc
{
  "userId":"...", "deviceId":"ChargerControl1369",
  "status":"online",                 // online/offline suy ra từ heartbeat
  "st":"RUN","flt":"0","lock":"0","rtry":"0","out":"BAT",
  "mode":"MPPT","ms":"TRACK","temp":"42.1",
  "vpv":"60.52","ipv":"8.21","ppv":"497",
  "vbat":"48.10","ibat":"9.90","il":"10.12","duty":"0.812","vref":"60.2",
  "cfgVbat":"54.0","cfgIbat":"20.0","cfgPbat":"500","src":"ESP","cfgOut":"BAT", // đang áp dụng
  "fw":"1.0.0","hw":"F303CB","raw":"$TLM,...*4E"
}
```

### 3.2 WebSocket realtime — namespace `/cms`

Kết nối kèm JWT (`auth.token` hoặc header `Authorization: Bearer ...`).

```js
socket.emit('subscribe',   { userId, deviceId });
socket.emit('unsubscribe', { userId, deviceId });

socket.on('chargerData',      d => {}); // TLM/CFG/INFO backend đã parse từ khung raw
socket.on('chargerStatus',    d => {}); // { status: "online" }
socket.on('chargerOtaStatus', d => {}); // tiến trình OTA
```

> `chargerData` là khung device đã được **backend parse** từ chuỗi raw (mục 2.1) —
> mobile/web không cần tự parse khung `$...*CRC`.

### 3.3 Lưu ý bắt buộc (mục 6 INTERGRATION.md)
- Coi giá trị **đã áp dụng thật** = `cfgVbat`/`cfgIbat` (từ khung `$CFG`), không chỉ lệnh đã gửi.
- Nếu `src = "LOCAL"` → hiển thị: *"Hãy chọn nguồn ESP32 trên máy để điều khiển từ xa."*
- Dòng điện có thể hơi âm khi không tải → kẹp về ≥ 0 khi hiển thị. Giá trị lỗi = `NAN`.

---

## 4. Phần dùng cho Web

Web bản **người dùng cuối**: dùng bộ `/api/user/chargers/*` với **Firebase JWT**
(header `Authorization: Bearer <firebase-id-token>`), giống hệt web inverter chạy
qua `/api/user/*`. `uid` lấy từ token — **không truyền trên URL**. Realtime: nghe
MQTT broker trực tiếp (mục 3.2).

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/user/chargers` | Danh sách charger của user |
| GET | `/api/user/chargers/{deviceId}` | Chi tiết 1 charger |
| GET | `/api/user/chargers/{deviceId}/data/latest` | Snapshot realtime (kèm `status`) |
| GET | `/api/user/chargers/{deviceId}/settings` | Đọc setting (kèm `vbat`/`ibat` decode) |
| PATCH | `/api/user/chargers/{deviceId}/settings` | Ghi `{ "vbat":54.0, "ibat":20.0 }` **hoặc** `{ "value":"05400200" }` |
| PATCH | `/api/user/chargers/{deviceId}/description` | Đổi ghi chú |
| PATCH | `/api/user/chargers/{deviceId}` | Đổi `deviceName` / `description` |

Web bản **quản trị/CMS** dùng bộ endpoint riêng `/api/cms/charger/*`.
**Tất cả yêu cầu JWT admin** (header `Authorization: Bearer <admin-token>`, lấy từ
`POST /api/cms/login`) — dùng chung `AdminGuard` với CMS inverter.

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/cms/charger/dashboard` | Thống kê: tổng, online/offline, thêm hôm nay/tuần |
| GET | `/api/cms/charger/devices?page=&limit=&userId=&deviceId=&search=` | Danh sách charger (lọc + tìm kiếm + phân trang) |
| GET | `/api/cms/charger/devices/{id}` | Chi tiết theo `_id` |
| GET | `/api/cms/charger/devices/{uid}/{deviceId}/details` | Gộp: device + snapshot realtime (kèm `online`) + setting (decode `vbat`/`ibat`) |
| PUT | `/api/cms/charger/devices/{id}` | Sửa `deviceName` / `firmwareVersion` |
| DELETE | `/api/cms/charger/devices/{id}` | Xóa thiết bị |
| POST | `/api/cms/charger/devices/{id}/firmware-update` | Kích hoạt OTA `{ "targetVersion":"1.0.1" }` → publish `charger/{uid}/{deviceId}/firmware/update` |

WebSocket giống mục 3.2 (`chargerData`/`chargerStatus`/`chargerOtaStatus`) — CMS
gateway `/cms` cần JWT admin.

---

## 5. Định dạng giá trị (dùng chung)

### 5.1 Setting `HHHHLLLL`
`HHHH = round(VBAT×10)`, `LLLL = round(IBAT×10)`, mỗi phần 4 số zero-pad.

| value | VBAT | IBAT |
|---|---|---|
| `05400200` | 54.0 V | 20.0 A |
| `04800100` | 48.0 V | 10.0 A |
| `10000999` | 100.0 V | 99.9 A |
