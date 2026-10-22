# Hybrid device API (HINVLF v1)

Hybrid = ESP32 + STM32 hybrid low-frequency inverter (battery, grid AC IN,
load output). STM32 protocol: esp32-hybrid `PROTOCOL_HINVLF_V1.md`. Own device
type (collections `hybriddevices`, `hybridsettings`, `hybriddatas`,
`hybridenergies`; MQTT namespace `hybrid/...`).

## Firmware (no user session)

| Call | Purpose |
|---|---|
| `POST /api/hybrid-device/provision` `{deviceId, claim, firmwareVersion?}` | Exchange the setup claim for the device's own MQTT account. Returns `{userId, mqttUsername: "hyb_<deviceId>", mqttPassword}` (403 = claim invalid/expired) |
| `PATCH /api/hybrid-device/data/{uid}/{deviceId}/firmware` `{firmwareVersion}` | Report the running version (Basic auth) |
| `GET /api/hybrid-setting/data/{uid}/{deviceId}?source=hardware` | `{set: "MODE=EXPORT,PEXP=1500,VCUT=42.0"}` — `""` = nothing set (Basic auth) |
| `GET /api/hybrid-firmware?deviceId=` | `{url}` of the active build (CMS -> ESP32 Firmware -> Hybrid) (Basic auth) |

**Basic auth** = `Authorization: Basic base64(hyb_<deviceId>:<mqtt password>)`, the
account from provisioning (over HTTPS only). 401 = missing / wrong credentials,
403 = the account is not this device / owner.

### Settings model

- The server stores only the writable keys the user has set (MODE PCHG PEXP
  PIMP VEXP VCUT VRES PMAX PCMAX). `set` is that config as a SET item list.
- The firmware `$SET`s the keys that differ from the STM32's `$CFG` (only
  when `SRC=ESP`) and re-applies them after an STM32 reboot (SET is RAM-only
  on the STM32). It never sends `$CMD,SAVE`.
- The server validates ranges + cross constraints (VCV / VBMAX from the latest
  `$CFG`) and applies the STM32 pull-along rules for keys not in the request
  (PMAX < PEXP → PEXP = PMAX, PCMAX < PCHG → PCHG = PCMAX, VRES > VEXP →
  VEXP = VRES), so what is stored is what the machine will run.

### MQTT (account `hyb_<deviceId>`, TLS 8883)

Publishes:

- `hybrid/{uid}/{deviceId}/data` - raw STM32 frame: `$TLM,...*CRC`, `$CFG,...`,
  `$INFO,...`, `$NAK,...`. Only `$TLM` is rate-limited by the server (3 s).
- `hybrid/{uid}/{deviceId}/status` - `{"updatedAt":"...","status":"online"}`
- `hybrid/{uid}/{deviceId}/ota/status` - `{"status":..,"progress":..,"message":..}`

Subscribes:

- `hybrid/{uid}/{deviceId}/cmd/settings` (retained) - "pull the setting again"
- `hybrid/{uid}/{deviceId}/cmd/action` (NOT retained) - `{"cmd":"FAULT_RST"|"STOP"|"RUN","ts":<ms>}`
- `hybrid/{uid}/{deviceId}/firmware/update` (retained) - `{"ts": <epoch ms>}`, empty = cleared
- `hybrid/{uid}/{deviceId}/blacklist` (retained) - `{"lock": bool}`

## App / web (Firebase auth) - `/api/user/hybrids`

| Call | |
|---|---|
| `GET /` | `{hybrids: [...]}` |
| `POST /claim` | One-time setup code (30 min) |
| `GET/PATCH/DELETE /{id}` | Detail / rename (`deviceName`, `description`) / remove (also revokes the MQTT account, deletes data + energy + settings) |
| `GET /{id}/data/latest` | `{tlm, tlmAt, cfg, cfgAt, info, lastNak, status, lastSeenAt}` — `tlm` / `cfg` / `info` are KEY → string maps of the last frames |
| `GET /{id}/settings` | `{config, set, updatedAt, cfg, cfgAt, src, pending[], lastNak, status, keys, readonlyKeys}` |
| `PATCH /{id}/settings` | Partial `{MODE?, PCHG?, …}` (or `{config: {...}}`). 400 `{message, errors: [{key, message}]}` |
| `POST /{id}/command` `{cmd}` | `FAULT_RST` (xóa lỗi / bỏ khóa), `STOP`, `RUN` → `cmd/action` |
| `GET /{id}/energy?from=&to=` | `{from, to, today, days: [{day, edis, echg, eimp, eexp}]}` (Wh, VN days, default last 30) |
| `GET /{id}/activity` | Settings / command history |
| `GET /firmware/newest`, `GET /{id}/firmware/version`, `POST /{id}/firmware/update` | OTA |

`pending` = config keys the machine's `$CFG` doesn't show yet (offline,
`SRC=LOCAL`, or refused — see `lastNak.err`: LOCAL / BUSY / RANGE / …).

Energy: the server adds the `$TLM` counter increments (EDIS battery discharge,
ECHG battery charge, EIMP grid import, EEXP grid export) using `UP` to detect
an STM32 reboot, and flushes daily totals every 60 s.

The app MQTT account (`app_<uid>`) may read `hybrid/{uid}/...` (live frames).

## CMS (admin JWT) - `/api/cms/hybrid`

Same shape as `/api/cms/charger`, so the CMS pages can be shared.

| Call | |
|---|---|
| `GET /dashboard` | `{totalDevices, onlineDevices, offlineDevices, faultDevices, localSourceDevices, devicesAddedToday, devicesAddedThisWeek}` |
| `GET /devices?search=&status=&page=&limit=&userId=&deviceId=` | `{data, total, page, totalPages}`. `search` = deviceId (HybridControl<N>) / name / description / userId / owner email. `status` = `online` \| `offline` \| `fault` (online, FLT ≠ 0) \| `local` (online, SRC=LOCAL). Each row has `ownerEmail` and `summary {online, lastSeenAt, st, mode, flt, lock, src, vbat, stmFw}` |
| `GET /devices/{userId}/{deviceId}/details` | `{device, summary, data (tlm/cfg/info/lastNak), setting (config, set, pending), energy (30 days)}` |
| `GET /devices/{id}`, `PUT /devices/{id}` `{deviceName?, firmwareVersion?}` | Mongo `_id` |
| `DELETE /devices/{id}` | Remove from the owner, revoke the MQTT account, delete data / energy / settings |
| `POST /devices/{id}/firmware-update` | ESP32 OTA to the active build (CMS -> ESP32 Firmware -> Hybrid) |

Not yet for hybrids: sharing to viewers, Home Assistant, CMS pages (UI).
