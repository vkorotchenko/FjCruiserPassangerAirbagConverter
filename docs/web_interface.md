# Web / Mobile Configuration Interface

A WiFi-connected web UI for configuring and monitoring the converter. The whole
thing runs on a **single Adafruit Feather ESP32-S2** — the converter logic and
the web host live in one firmware, with no separate bridge board or UART. The S2
is WiFi-only (no Bluetooth radio), and nothing in the firmware uses Bluetooth.

```
Browser (phone/PC)  <--WiFi: HTTP + WebSocket-->  Feather ESP32-S2
                                                  (converter + web host)
```

The control protocol runs **in-process**: the WebSocket handler feeds command
lines straight into the control engine (`EspLink`), which emits events back to
all WebSocket clients. The browser app and the JSON protocol are identical to
what a UART bridge would carry — only the transport changed.

## Modules

| Path | What |
|------|------|
| `include/control_protocol.h` | Wire protocol (type tags + field keys) |
| `src/RuntimeConfig.*` | Runtime-editable settings, persisted to **NVS** (ESP32 `Preferences`) |
| `src/EspLink.*` | Control engine: command dispatch, validation, log/frame forwarding (rings) |
| `src/WebInterface.*` | WiFi AP/STA, LittleFS, AsyncWebServer + WebSocket, wired to `EspLink` |
| `web/` | Single-page app (`index.html`, `app.css`, `app.js`) |
| `data_esp/` | Gzipped SPA → ESP32 LittleFS image (`scripts/build_web.sh`) |

## Build & flash

```bash
pio run -t upload          # converter + web-host firmware
scripts/build_web.sh       # gzip web/ -> data_esp/
pio run -t uploadfs        # web UI -> LittleFS
```

Connect to WiFi AP **`FJ-OCS-Config`** (default WPA2 pass `fjcruiser` — change
`WIFI_AP_PASS` in `src/config.h` before field use) and open `http://192.168.4.1`.
Optionally join your home WiFi from the UI (saved to NVS); the AP stays up as a
fallback. Flash size is ~89% of the default app partition; for OTA you'd switch
to a min-SPIFFS / dual-app partition scheme.

## Pin map — needs your confirmation

Peripheral pins live in **`src/config.h`** and are physical wiring choices (a
reflash to change). The active peripherals use **board-named macros** (`RX`/`TX`
for K-line, `A0`/`A1` for button/relay) that the Feather ESP32-S2 variant remaps
to the right GPIOs automatically. The raw-GPIO picks for CAN/DPOT are old V2-era
numbers and are marked `TODO confirm` — re-verify them for the S2 before enabling
those peripherals:

| Peripheral | config.h value | Notes |
|------------|----------------|-------|
| K-line RX / TX (SN65HVDA195) | `RX` / `TX` | OBD9141 drives Serial1; board-named, remaps on S2 |
| CAN MCP2515 chip-select | `14` (raw) | S2 SPI is SCK 36 / MOSI 35 / MISO 37 — re-confirm before enabling CAN |
| Digital-pot 1–4 (CS/INC/UD) | raw V2 GPIOs | placeholders; reassign for the S2 before enabling DPOT output |
| Button | `A0` | board-named; remaps on S2 |
| Relay | `A1` | board-named; placeholder until wired |

> The Feather ESP32-S2 is WiFi-only (no Bluetooth) with ~20 usable GPIOs; GPIO 46
> is input-only and GPIO 26 backs the PSRAM. You can't wire every peripheral at
> once — the FJ K-line use case only needs the two K-line pins, so the DPOT/CAN
> pins only matter if you enable those outputs.

## JSON control protocol

Newline-delimited JSON. Every message has a type tag `t`; commands may carry a
numeric `id` echoed back in `ack`/`err`.

### Commands (browser → ESP32 → EspLink)

| `t` | Fields | Effect |
|-----|--------|--------|
| `get_config` | — | replies `config` |
| `set_config` | `cfg{...}` (partial) | validate + merge + persist (NVS); replies `config` + `ack` |
| `get_state` | — | replies `state` |
| `set_override` | `enabled`, `buckled`, `passengerType` | force passenger state for bench testing |
| `start_capture` | `src`: `can`\|`kline`\|`all` | begin forwarding raw frames |
| `stop_capture` | — | stop capture |
| `reset` | — | factory-reset config to `config.h` defaults |

### Events (EspLink → browser)

| `t` | Fields |
|-----|--------|
| `config` | `cfg{ useKlineInput, …, activeProtocol, ocsCanId1/2, pidSeatbeltStatus, pidPassengerType, dpotPosition*, version }` |
| `state` | `buckled`, `passengerType` (0=none,1=child,2=adult), `override`, `linkKline`, `linkCan`, `ts` |
| `log` | `lvl` (`info`\|`debug`), `msg`, `ts` |
| `frame` | `bus` (`can`\|`kline`), CAN: `id`,`ext`; K-line: `mode`,`pid`; plus `len`,`data[]`,`ts` |
| `ack` / `err` | `id` (+ `code`,`msg` on error) |

### Editable config fields

| Field | Range / values |
|-------|----------------|
| `useKlineInput`/`useCanInput`/`useButtonInput` | bool |
| `useKlineOutput`/`useCanOutput`/`useDpotOutput`/`useRelayOutput` | bool |
| `activeProtocol` | 0 = K-line, 1 = CAN |
| `ocsCanId1`, `ocsCanId2` | 0 … 0x1FFFFFFF |
| `pidSeatbeltStatus`, `pidPassengerType` | 0 … 0xFF |
| `dpotPositionOff/Child/Adult` | 0 … 99 |

Pin assignments are **not** here — they are compile-time in `src/config.h`.

## Capture → vehicle database

The **Capture** tab lists every observed frame (changed bytes highlighted to spot
the occupant signal) and exports two formats that feed the protocol DB in `data/`:

- **JSON snippet** — a `signals[]` fragment for `data/vehicle_protocols.json`
- **Mongo line** — `db.vehicles.updateOne(..., { $push: { 'occupantClassification.canFrames': … } })`

## Runtime gating

All handlers are compiled in; `RuntimeConfig` flags decide what runs.
`Handler::isActive()` gates each handler's `process()`, and `InputOutputManager`
checks a per-slot enable pointer next to `isInputReady()`/`isOutputReady()`. Heavy
bus `setup()` (CAN/K-line) runs at boot only when enabled, so an absent bus can't
hang — enabling a bus that was off at boot needs a reboot.
