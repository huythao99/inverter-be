# STM32 FOTA (power board, flashed through the ESP32)

Backend / CMS / web / app side is implemented. The ESP32 side (firmware
1.0.15, `esp32-inverter/src/stm_fota.cpp`) implements the contract below:
image kept in LittleFS (`/stm_new.bin` -> `/stm_cur.bin`, previous one in
`/stm_prev.bin`), up to 3 flash attempts, and a restore of the previous image
when a failed attempt may have erased the STM32 app.

## Versioning

STM32 versions are `major.voltage.patch` (from the STM32 team's handover):

    3.4.7
    │ │ └─ release
    │ └─── voltage class  1 = 12V  2 = 24V  3 = 36V  4 = 48V
    └───── product gen / chip  3 = grid-tie F303  2 = grid-tie G431

A device only gets images with the **same major and voltage** as the version
its STM32 runs; among those the highest version wins (F303 and G431 images are
not interchangeable, nor are voltages).

**Where the device version comes from:** STM32 firmware >= 2.0.0 appends it
as the 13th telemetry field (`...#1234#567#3.1.1`). The ESP32 forwards it in
the data frame and the backend stores it on the device (`stmFwVersion`) when
it changes — no extra report needed. Boards on older STM32 firmware (12
fields) have no version, so they are not offered STM32 updates.

## Firmware images (static files)

Same server/scheme as the ESP32 firmware (`https://giabao-inverter.com/firmware`),
one folder per version (nginx on that server forwards `/firmware/stm/` to
DigitalOcean Spaces `gticontrol.sgp1.digitaloceanspaces.com/firmware/stm/`,
files there must be public-read):

    {STM_FIRMWARE_BASE_URL}/{product}/{version}/app.bin   (+ app.json)
    default base: https://giabao-inverter.com/firmware/stm
    e.g.          https://giabao-inverter.com/firmware/stm/inverter/3.4.1/app.bin

Upload the files there, then register the version in **CMS → STM32 Firmware**
(product, channel, version — the URL is derived; an explicit app.bin URL can
still be given to override it). The backend downloads the file, computes size
+ CRC32 (zlib) and checks the vector table; if an `app.json` sits next to it
its size/crc32 must match. Never overwrite a registered file in place — upload
a new version instead (the stored CRC would no longer match).

A device gets the newest **enabled** image with its own major + voltage:
`stable` for everyone, `beta` additionally for devices on the CMS beta list.

## Device contract (ESP32)

Only ESP32 firmware >= `STM_FOTA_MIN_ESP_VERSION` (env, default `1.0.15`) is
offered STM32 updates.

1. **STM32 version**: comes automatically from telemetry field 13 (the ESP32
   must accept 10, 12 or 13-field frames, the 13th being `x.y.z`). Optional
   explicit report (e.g. with the CRC):
   - `PATCH /api/stm-firmware/info/:userId/:deviceId`
     `{ "version": "3.4.1", "crc32": "0x..." }`
   - or MQTT `inverter/{uid}/{deviceId}/stm/info` with the same JSON.

2. **Trigger** (non-retained, QoS 0) on `inverter/{uid}/{deviceId}/stm/update`:
   `{ "action": "stm_update", "version": "1.2.0", "crc32": "0x...", "force": false, "ts": 1790000000000 }`
   Kept < 256 B with the topic (PubSubClient default buffer).

3. **Fetch the image info**: `GET /api/stm-firmware?deviceId=&userId=` →
   `{ id, product, channel, version, voltageCode, voltage, url, size, crc32, appBase }`
   (404 when there is nothing to flash). Download `url`, check size + CRC32
   BEFORE touching the STM32; refuse if the major or 2nd number of `version`
   differs from the board's current one (`gti_fota.h` also checks chip /
   voltage / product from the image tail and the bootloader HELLO).

4. **Progress** on `inverter/{uid}/{deviceId}/stm/ota/status`:
   `{ "status": "...", "progress": 0-100, "message": "..." }` with status in
   `starting | downloading | verifying | flashing | success | failed | rescue_needed`.
   After `success` report the new version (step 1).

## Where it shows up

- CMS: *STM32 Firmware* page (registry), STM32 card on the device page
  (single update + live progress), bulk update with target "STM32 power board"
  (skips: ESP32 too old, version unknown / no image for its voltage, up to date, beta).
- Web: Settings tab → "Mạch công suất (STM32)".
- App: Setting tab → "Mạch công suất (STM32)" card.
  Web/app hide the section until the device supports it.

## API summary

| Who | Route |
|---|---|
| ESP32 | `GET /api/stm-firmware`, `PATCH /api/stm-firmware/info/:userId/:deviceId` |
| CMS | `GET/POST /api/cms/stm-firmwares`, `PATCH/DELETE /api/cms/stm-firmwares/:id`, `GET /api/cms/devices/:id/stm`, `POST /api/cms/devices/:id/stm-update`, `POST /api/cms/firmware-bulk-updates { target: "stm32" }` |
| Web/App | `GET /api/user/devices/:deviceId/stm`, `POST /api/user/devices/:deviceId/stm/update` |
