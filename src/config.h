#ifndef CONFIG_H_
#define CONFIG_H_

// Serial port for USB debugging/logging (USB CDC on the ESP32)
#define SERIAL_PORT_MONITOR Serial

#define SERIAL_SPEED 115200

// Firmware identity. Surfaced to the mobile/web client via GET /api/info
// ("fwVersion") and used by the in-app updater to detect new releases.
// Overridable at build time: CI injects -DFIRMWARE_VERSION='"X.Y.Z"' from the
// release tag (see .github/workflows/firmware-release.yml); local builds use
// the default below.
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// ============================================================================
// TARGET BOARD: Adafruit Feather ESP32-S2 (WiFi-only, no Bluetooth)
// ----------------------------------------------------------------------------
// The ACTIVE peripherals are addressed by board-named macros (RX/TX for the
// K-line UART, A0/A1 for the button/relay, LED_BUILTIN): the Arduino variant
// remaps those to the S2's GPIOs automatically, so they stayed correct across
// the V2 -> S2 move with no edits.
//
// The RAW GPIO numbers further down (CAN chip-select and the DPOT pins) were
// chosen for the old Feather ESP32 V2 numbering and MUST be re-confirmed against
// the S2 pinout before enabling those peripherals. Notes on the S2:
//   - Default SPI is SCK 36 / MOSI 35 / MISO 37 (used by the CAN wing).
//   - GPIO 46 is INPUT-ONLY; GPIO 26 backs the PSRAM and is not usable.
//   - You cannot run every peripheral at once; the FJ K-line use case only needs
//     K-line (2 pins), so the DPOT/CAN pins only matter if you enable those.
// ============================================================================

// ---- CAN (MCP2515 CAN Bus FeatherWing, over SPI) ----
// SPI is fixed by the Feather S2 (SCK 36 / MOSI 35 / MISO 37). CAN is OFF by
// default; the chip-select GPIO below is an old V2-era pick and MUST be
// re-confirmed for the S2 pinout (and the FeatherWing's CS solder-jumper) before
// enabling CAN.
#define CAN_SPEED                              16
#define CLOCK_SPEED                            MCP_8MHz
#define SPI_CS_PIN                             14      // MCP2515 CS - re-confirm on S2 before enabling CAN

#define OCS_CAN_ID_1 0x265
#define OCS_CAN_ID_2 0x453

// ---- K-line (ISO 9141-2 via SN65HVDA195 transceiver + OBD9141) ----
// The transceiver breakout needs no enable GPIO; the only interface is the
// Feather's hardware UART RX/TX (Serial1). OBD9141 drives these GPIOs directly.
#define KLINE_RX_PIN RX       // board "RX" silkscreen (Serial1) <- transceiver RXD
#define KLINE_TX_PIN TX       // board "TX" silkscreen (Serial1) -> transceiver TXD
#define KLINE_INIT_RETRIES 3
#define KLINE_INIT_DELAY 2000
#define KLINE_TIMEOUT 5000

// ---- Digital Potentiometer (X9C10X) - 4 seat-corner sensors ----
// NOTE: unused / likely to be removed. USE_DPOT_OUTPUT is off and the handler's
// setup() is skipped while disabled, so these pins are NOT claimed. The values
// below are placeholders and overlap other peripherals - reassign before
// enabling DPOT output.
#define DPOT_MAX_OHM 10000  // X9C103 = 10kΩ (can be 1k, 10k, 50k, or 100k)

// Potentiometer 1 (Front Left)   -- TODO confirm GPIOs
#define DPOT1_CS_PIN  27
#define DPOT1_INC_PIN 33
#define DPOT1_UD_PIN  15
// Potentiometer 2 (Front Right)
#define DPOT2_CS_PIN  32
#define DPOT2_INC_PIN 26     // A0
#define DPOT2_UD_PIN  25     // A1
// Potentiometer 3 (Rear Left)
#define DPOT3_CS_PIN  4      // A5
#define DPOT3_INC_PIN 13
#define DPOT3_UD_PIN  12
// Potentiometer 4 (Rear Right)
#define DPOT4_CS_PIN  20     // SCL
#define DPOT4_INC_PIN 22     // SDA
#define DPOT4_UD_PIN  21     // MISO (only free if SPI/CAN unused)

// Potentiometer positions for occupant states (0-99 range)
// Formula: Resistance = (DPOT_MAX_OHM * Position) / 99
#define DPOT_POSITION_OFF 0     // 0Ω - Empty seat, airbag off
#define DPOT_POSITION_CHILD 50  // ~50% resistance - Child weight
#define DPOT_POSITION_ADULT 99  // Maximum resistance - Adult weight

// ---- Button input ----
#define BUTTON_PIN          A0      // board A0 - button to GND, internal pull-up
#define BUTTON_DEBOUNCE_MS  50
#define BUTTON_ACTIVE_LOW   1       // 1 = button connects to GND, 0 = to VCC

// ---- Relay output (not wired yet; USE_RELAY_OUTPUT off, setup() skipped) ----
#define RELAY_PIN           A1      // board A1 - placeholder, only claimed if relay enabled
#define RELAY_ACTIVE_HIGH   1       // 1 = relay activates on HIGH, 0 = on LOW

// ========================================
// Passenger State Input/Output defaults
// (runtime-editable via the web UI; these seed the first boot only)
// ========================================
#define USE_KLINE_INPUT     1    // 1 = enabled, 0 = disabled
#define USE_CAN_INPUT       0
#define USE_BUTTON_INPUT    1    // button on A0

#define USE_KLINE_OUTPUT    1
#define USE_CAN_OUTPUT      0
#define USE_DPOT_OUTPUT     0
#define USE_RELAY_OUTPUT    0

// ========================================
// WiFi / Web UI
// ========================================
#define WIFI_HOSTNAME       "fj-ocs"
#define WIFI_AP_SSID        "FJ-OCS-Config"
#define WIFI_AP_PASS        "fjcruiser"   // WPA2, >= 8 chars. CHANGE before field use.

// ========================================
// Control engine (EspLink) ring-buffer sizing
// ========================================
// Depths and the max messages flushed per poll() so a busy bus or log burst can
// never block the control loop. (No UART pins now: the web transport is
// in-process WebSocket on this single board.)
#define ESP_LINK_LOG_RING    12
#define ESP_LINK_LOG_LINE    128
#define ESP_LINK_FRAME_RING  32
#define ESP_LINK_SEND_BUDGET 4

#endif /* CONFIG_H_ */
