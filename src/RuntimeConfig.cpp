#include "RuntimeConfig.h"
#include "Logger.h"
#include <Preferences.h>

// Live, in-RAM configuration used by the rest of the firmware.
RuntimeConfig g_config;

// Persisted as a single blob in NVS (ESP32 non-volatile storage).
static Preferences configPrefs;
static const char *NVS_NAMESPACE = "fjocs";
static const char *NVS_KEY       = "cfg";

namespace ConfigStore {

void loadDefaults(RuntimeConfig& c) {
    memset(&c, 0, sizeof(c));
    c.magic   = RUNTIME_CONFIG_MAGIC;
    c.version = RUNTIME_CONFIG_VERSION;
    c.size    = sizeof(RuntimeConfig);

    // Enable flags - mirror the original config.h compile-time selection.
    c.useKlineInput  = USE_KLINE_INPUT;
    c.useCanInput    = USE_CAN_INPUT;
    c.useButtonInput = USE_BUTTON_INPUT;
    c.useKlineOutput = USE_KLINE_OUTPUT;
    c.useCanOutput   = USE_CAN_OUTPUT;
    c.useDpotOutput  = USE_DPOT_OUTPUT;
    c.useRelayOutput = USE_RELAY_OUTPUT;

    // Protocol & IDs. Default active protocol follows whichever K-line/CAN
    // path is enabled by default (K-line in the stock build).
    c.activeProtocol    = USE_KLINE_INPUT || USE_KLINE_OUTPUT ? PROTO_KLINE : PROTO_CAN;
    c.ocsCanId1         = OCS_CAN_ID_1;
    c.ocsCanId2         = OCS_CAN_ID_2;
    c.pidSeatbeltStatus = 0x60;   // PID_SEATBELT_STATUS (k_line.h)
    c.pidPassengerType  = 0x61;   // PID_PASSENGER_TYPE  (k_line.h)

    // Thresholds.
    c.dpotPositionOff   = DPOT_POSITION_OFF;
    c.dpotPositionChild = DPOT_POSITION_CHILD;
    c.dpotPositionAdult = DPOT_POSITION_ADULT;

    // Manual override off by default.
    c.overrideEnabled       = false;
    c.overrideBuckled       = false;
    c.overridePassengerType = 0;   // NO_PASSENGER

    c.crc32 = computeCrc(c);
}

// Standard CRC-32 (IEEE 802.3, reflected, poly 0xEDB88820), table-free.
uint32_t computeCrc(const RuntimeConfig& c) {
    const uint8_t* p = reinterpret_cast<const uint8_t*>(&c);
    const size_t len = sizeof(RuntimeConfig) - sizeof(c.crc32);
    uint32_t crc = 0xFFFFFFFFUL;
    for (size_t i = 0; i < len; i++) {
        crc ^= p[i];
        for (uint8_t b = 0; b < 8; b++) {
            crc = (crc >> 1) ^ (0xEDB88820UL & (-(int32_t)(crc & 1)));
        }
    }
    return crc ^ 0xFFFFFFFFUL;
}

bool save(const RuntimeConfig& c) {
    RuntimeConfig tmp = c;
    tmp.magic   = RUNTIME_CONFIG_MAGIC;
    tmp.version = RUNTIME_CONFIG_VERSION;
    tmp.size    = sizeof(RuntimeConfig);
    tmp.crc32   = computeCrc(tmp);
    configPrefs.begin(NVS_NAMESPACE, false);
    size_t written = configPrefs.putBytes(NVS_KEY, &tmp, sizeof(tmp));
    configPrefs.end();
    return written == sizeof(tmp);
}

bool load(RuntimeConfig& c) {
    RuntimeConfig stored;
    memset(&stored, 0, sizeof(stored));
    configPrefs.begin(NVS_NAMESPACE, true);
    size_t got = configPrefs.getBytes(NVS_KEY, &stored, sizeof(stored));
    configPrefs.end();

    const bool valid =
        got == sizeof(stored) &&
        stored.magic   == RUNTIME_CONFIG_MAGIC &&
        stored.size    == sizeof(RuntimeConfig) &&
        stored.crc32   == computeCrc(stored);

    if (!valid) {
        Logger::info("Config: no valid stored config, loading defaults");
        loadDefaults(c);
        save(c);
        return false;
    }

    if (stored.version != RUNTIME_CONFIG_VERSION) {
        // Forward-migration point. v1 is the first version, so just re-stamp.
        Logger::info("Config: migrating v%d -> v%d", stored.version, RUNTIME_CONFIG_VERSION);
        stored.version = RUNTIME_CONFIG_VERSION;
        c = stored;
        save(c);
        return true;
    }

    c = stored;
    return true;
}

void reset() {
    loadDefaults(g_config);
    save(g_config);
    Logger::info("Config: reset to factory defaults");
}

} // namespace ConfigStore
