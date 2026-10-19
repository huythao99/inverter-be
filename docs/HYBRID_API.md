# Hybrid device API

Hybrid = ESP32 + STM32 MPPT that can charge the battery or feed the inverter /
grid. It is its own device type (collections `hybriddevices`,
`hybridsettings`, `hybriddatas`; MQTT namespace `hybrid/...`). The STM32
frames are the same as the charger's (`PROTOCOL_MPPT_V1_1.md`).

## Firmware (no user session)

| Call | Purpose |
|---|---|
| `POST /api/hybrid-device/provision` `{deviceId, claim, firmwareVersion?}` | Exchange the setup claim for the device's own MQTT account. Returns `{userId, mqttUsername: "hyb_<deviceId>", mqttPassword}` (403 = claim invalid/expired) |
| `PATCH /api/hybrid-device/data/{uid}/{deviceId}/firmware` `{firmwareVersion}` | Report the running version (Basic auth) |
| `GET /api/hybrid-setting/data/{uid}/{deviceId}?source=hardware` | `{value: "HHHHLLLL" or "", gridTieOff: bool, out: "INV" or "BAT"}` (Basic auth) |
| `GET /api/hybrid-firmware?deviceId=` | `{url}` of the active build (CMS -> ESP32 Firmware -> Hybrid) (Basic auth) |

**Basic auth** = `Authorization: Basic base64(hyb_<deviceId>:<mqtt password>)`, the
account from provisioning (over HTTPS only). 401 = missing / wrong credentials,
403 = the account is not this device / owner.

`value` is the same 8 digits as the charger: HHHH = VBAT x10, LLLL = IBAT x10.

### MQTT (account `hyb_<deviceId>`, TLS 8883)

Publishes (same payloads as the charger):

- `hybrid/{uid}/{deviceId}/data` - raw STM32 frame (`$TLM,...*CRC`, `$CFG,...`, `$INFO,...`)
- `hybrid/{uid}/{deviceId}/status` - `{"updatedAt":"...","status":"online"}`
- `hybrid/{uid}/{deviceId}/ota/status` - `{"status":..,"progress":..,"message":..}`

Subscribes (all retained by the server):

- `hybrid/{uid}/{deviceId}/cmd/settings` - "pull the setting again"
- `hybrid/{uid}/{deviceId}/cmd/grid-tie` - `{"off": true|false}`
- `hybrid/{uid}/{deviceId}/firmware/update` - `{"ts": <epoch ms>}`, empty = cleared
- `hybrid/{uid}/{deviceId}/blacklist` - `{"lock": bool}` (reserved)

## Grid-tie ("hoà lưới")

| State | `gridTieOff` | STM32 command |
|---|---|---|
| ON (default) | `false` | `$SET,OUT=INV` - feed the inverter / grid |
| OFF | `true` | `$SET,OUT=BAT` - charge the battery only |

The firmware should:

1. Apply `out` from the setting API on boot / every pull, and the value from
   `cmd/grid-tie` as soon as it arrives; keep the last state in NVS.
2. Send `$SET,OUT=...` only when the STM32 `$CFG` shows a different `OUT`
   (changing OUT restarts the power stage). Needs `SRC=ESP` on the machine.
3. The server checks the result from `$CFG OUT` / `$TLM OUT`
   (`GET /api/user/hybrids/{id}/grid-tie` -> `applied`).

## App / web (Firebase auth) - `/api/user/hybrids`

| Call | |
|---|---|
| `GET /` | `{hybrids: [...]}` |
| `POST /claim` | One-time setup code (30 min) |
| `GET/PATCH/DELETE /{id}` | Detail / rename (`deviceName`, `description`) / remove (also revokes the MQTT account) |
| `GET /{id}/data/latest` | Merged telemetry + `status` online/offline |
| `GET/PATCH /{id}/settings` | `{value}` or `{vbat, ibat}`; response has `gridTieOff` too |
| `GET/PATCH /{id}/grid-tie` | PATCH `{status: 1}` = OFF, `{status: 0}` = ON. Response `{status, gridTieOff, out, currentOut, applied}` |
| `GET /{id}/activity` | Settings / grid-tie history |
| `GET /firmware/newest`, `GET /{id}/firmware/version`, `POST /{id}/firmware/update` | OTA |

The app MQTT account (`app_<uid>`) may read `hybrid/{uid}/...`.

Not yet for hybrids: sharing to viewers, Home Assistant, CMS pages, blacklist.
