#ifndef RUNTIME_CONFIG_H_
#define RUNTIME_CONFIG_H_

#include <Arduino.h>
#include "config.h"
#include "control_protocol.h"   // ProtocolId

/*
 * RuntimeConfig: the subset of settings that can be changed at runtime from the
 * web UI and persisted to flash. Pin assignments are deliberately NOT here -
 * they are physically wired and stay compile-time #defines in config.h.
 *
 * Defaults are sourced from config.h via ConfigStore::loadDefaults(), so there
 * is exactly one definition of "factory default" and a fresh device behaves
 * identically to the original compile-time build.
 *
 * The struct is plain-old-data so it can be byte-copied to/from flash. A
 * magic/version/size header plus a CRC32 guard against uninitialised or stale
 * flash contents.
 */

#define RUNTIME_CONFIG_MAGIC    0x46414342UL   // 'FACB'
#define RUNTIME_CONFIG_VERSION  1

struct RuntimeConfig {
    uint32_t magic;     // RUNTIME_CONFIG_MAGIC
    uint16_t version;   // RUNTIME_CONFIG_VERSION
    uint16_t size;      // sizeof(RuntimeConfig) sanity check

    // --- enable flags (replace the compile-time USE_* #if selection) ---
    bool useKlineInput;
    bool useCanInput;
    bool useButtonInput;
    bool useKlineOutput;
    bool useCanOutput;
    bool useDpotOutput;
    bool useRelayOutput;

    // --- protocol & IDs (runtime-editable, persisted) ---
    uint8_t  activeProtocol;     // ProtocolId
    uint32_t ocsCanId1;
    uint32_t ocsCanId2;
    uint8_t  pidSeatbeltStatus;
    uint8_t  pidPassengerType;

    // --- thresholds (0..99 digital-pot positions) ---
    uint8_t dpotPositionOff;
    uint8_t dpotPositionChild;
    uint8_t dpotPositionAdult;

    // --- manual override for bench testing ---
    bool    overrideEnabled;
    bool    overrideBuckled;
    uint8_t overridePassengerType;   // PassengerType numbering (0/1/2)

    uint32_t crc32;     // over all bytes preceding this field
};

// Global live config. Defined in RuntimeConfig.cpp, populated by setup().
extern RuntimeConfig g_config;

namespace ConfigStore {
    // Fill c with factory defaults taken from config.h (no flash access).
    void loadDefaults(RuntimeConfig& c);

    // Load from flash into c. On bad magic / version / size / CRC, c is reset
    // to defaults, persisted, and false is returned.
    bool load(RuntimeConfig& c);

    // Recompute CRC and write c to flash. Returns true on success.
    bool save(const RuntimeConfig& c);

    // Reset g_config to defaults and persist.
    void reset();

    // CRC32 over the struct excluding the trailing crc32 field.
    uint32_t computeCrc(const RuntimeConfig& c);
}

#endif // RUNTIME_CONFIG_H_
