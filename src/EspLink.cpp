#include "EspLink.h"
#include "RuntimeConfig.h"
#include "CanHandler.h"
#include "KLineInput.h"

// Global singleton
EspLink espLink;

EspLink::EspLink()
    : sender(nullptr)
    , captureCan(false)
    , captureKline(false)
    , logHead(0), logCount(0)
    , frameHead(0), frameCount(0)
{
}

void EspLink::setup() {
    Logger::info("EspLink: control engine ready (in-process WebSocket transport)");
}

// Serialize a document and hand the rendered line to the active sender.
void EspLink::emit(JsonDocument &doc) {
    if (!sender) return;
    char buf[CONTROL_LINE_MAX];
    size_t n = serializeJson(doc, buf, sizeof(buf));
    if (n == 0 || n >= sizeof(buf)) return;   // dropped: too large to frame
    sender(buf);
}

// ---------------------------------------------------------------------------
// Enqueue side (non-blocking) - LogSink + capture hooks
// ---------------------------------------------------------------------------

void EspLink::writeLine(int level, const char *line) {
    uint8_t slot = (logHead + logCount) % ESP_LINK_LOG_RING;
    if (logCount == ESP_LINK_LOG_RING) {
        logHead = (logHead + 1) % ESP_LINK_LOG_RING;   // drop oldest
    } else {
        logCount++;
    }
    strncpy(logRing[slot], line, ESP_LINK_LOG_LINE - 1);
    logRing[slot][ESP_LINK_LOG_LINE - 1] = '\0';
    logLevelRing[slot] = (int8_t) level;
}

static void pushFrame(CapturedFrame *ring, uint8_t &head, uint8_t &count,
                      const CapturedFrame &f) {
    uint8_t slot = (head + count) % ESP_LINK_FRAME_RING;
    if (count == ESP_LINK_FRAME_RING) {
        head = (head + 1) % ESP_LINK_FRAME_RING;        // drop oldest
    } else {
        count++;
    }
    ring[slot] = f;
}

void EspLink::captureCanFrame(uint32_t id, bool ext, const uint8_t *data, uint8_t len) {
    if (!captureCan) return;
    CapturedFrame f;
    f.bus = 0; f.id = id; f.mode = 0; f.ext = ext;
    f.len = len > 8 ? 8 : len;
    for (uint8_t i = 0; i < f.len; i++) f.data[i] = data[i];
    f.ts = millis();
    pushFrame(frameRing, frameHead, frameCount, f);
}

void EspLink::captureKlineFrame(uint8_t mode, uint8_t pid, const uint8_t *data, uint8_t len) {
    if (!captureKline) return;
    CapturedFrame f;
    f.bus = 1; f.id = pid; f.mode = mode; f.ext = false;
    f.len = len > 8 ? 8 : len;
    for (uint8_t i = 0; i < f.len; i++) f.data[i] = data[i];
    f.ts = millis();
    pushFrame(frameRing, frameHead, frameCount, f);
}

// ---------------------------------------------------------------------------
// Drain side - runs in poll()
// ---------------------------------------------------------------------------

void EspLink::drainLogs(uint8_t budget) {
    while (logCount > 0 && budget-- > 0) {
        JsonDocument doc;
        doc[KEY_TYPE] = MSG_LOG;
        doc[KEY_LEVEL] = (logLevelRing[logHead] == Logger::Debug) ? LVL_DEBUG : LVL_INFO;
        doc[KEY_MSG] = logRing[logHead];
        doc[KEY_TS] = millis();
        emit(doc);
        logHead = (logHead + 1) % ESP_LINK_LOG_RING;
        logCount--;
    }
}

void EspLink::drainFrames(uint8_t budget) {
    while (frameCount > 0 && budget-- > 0) {
        const CapturedFrame &f = frameRing[frameHead];
        JsonDocument doc;
        doc[KEY_TYPE] = MSG_FRAME;
        if (f.bus == 0) {
            doc[KEY_BUS] = BUS_CAN;
            doc[KEY_FRAME_ID] = f.id;
            doc[KEY_EXT] = f.ext;
        } else {
            doc[KEY_BUS] = BUS_KLINE;
            doc[KEY_MODE] = f.mode;
            doc[KEY_PID] = f.id;
        }
        doc[KEY_LEN] = f.len;
        JsonArray arr = doc[KEY_DATA].to<JsonArray>();
        for (uint8_t i = 0; i < f.len; i++) arr.add(f.data[i]);
        doc[KEY_TS] = f.ts;
        emit(doc);
        frameHead = (frameHead + 1) % ESP_LINK_FRAME_RING;
        frameCount--;
    }
}

// ---------------------------------------------------------------------------
// Main poll
// ---------------------------------------------------------------------------

void EspLink::poll() {
    // Inbound commands arrive via handleLine() from the WebSocket handler.
    // Here we just flush queued events under a budget so a busy bus or log
    // burst can never block the control loop.
    drainLogs(ESP_LINK_SEND_BUDGET);
    drainFrames(ESP_LINK_SEND_BUDGET);
}

// ---------------------------------------------------------------------------
// Command handling
// ---------------------------------------------------------------------------

void EspLink::handleLine(const char *line) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line);
    if (err) {
        sendErr(0, ERR_PARSE, err.c_str());
        return;
    }

    const char *type = doc[KEY_TYPE] | "";
    long id = doc[KEY_ID] | 0;

    if (strcmp(type, MSG_GET_CONFIG) == 0) {
        sendConfig();
        sendAck(id);
    } else if (strcmp(type, MSG_SET_CONFIG) == 0) {
        JsonObjectConst cfg = doc[KEY_CFG];
        if (cfg.isNull()) { sendErr(id, ERR_BAD_FIELD, "missing cfg"); return; }
        if (applyConfig(cfg, id)) {
            ConfigStore::save(g_config);
            sendConfig();
            sendAck(id);
        }
    } else if (strcmp(type, MSG_GET_STATE) == 0) {
        publishState(passengerState, g_config.overrideEnabled);
        sendAck(id);
    } else if (strcmp(type, MSG_SET_OVERRIDE) == 0) {
        g_config.overrideEnabled = doc[KEY_ENABLED] | false;
        g_config.overrideBuckled = doc[KEY_BUCKLED] | false;
        long pt = doc[KEY_PASSENGER_TYPE] | 0;
        if (pt < 0 || pt > 2) { sendErr(id, ERR_OUT_OF_RANGE, "passengerType 0..2"); return; }
        g_config.overridePassengerType = (uint8_t) pt;
        publishState(passengerState, g_config.overrideEnabled);
        sendAck(id);
    } else if (strcmp(type, MSG_START_CAPTURE) == 0) {
        const char *src = doc[KEY_SRC] | SRC_ALL;
        captureCan   = (strcmp(src, BUS_CAN) == 0)   || (strcmp(src, SRC_ALL) == 0);
        captureKline = (strcmp(src, BUS_KLINE) == 0) || (strcmp(src, SRC_ALL) == 0);
        Logger::info("EspLink: capture started (can=%d kline=%d)", captureCan, captureKline);
        sendAck(id);
    } else if (strcmp(type, MSG_STOP_CAPTURE) == 0) {
        captureCan = captureKline = false;
        frameCount = 0;   // discard anything still queued
        Logger::info("EspLink: capture stopped");
        sendAck(id);
    } else if (strcmp(type, MSG_RESET) == 0) {
        ConfigStore::reset();
        sendConfig();
        sendAck(id);
    } else {
        sendErr(id, ERR_BAD_TYPE, type);
    }
}

bool EspLink::applyConfig(JsonObjectConst cfg, long id) {
    // Validate every supplied field first; only mutate g_config once all pass.
    RuntimeConfig c = g_config;

    if (cfg[CFG_USE_KLINE_IN].is<bool>())  c.useKlineInput  = cfg[CFG_USE_KLINE_IN];
    if (cfg[CFG_USE_CAN_IN].is<bool>())    c.useCanInput    = cfg[CFG_USE_CAN_IN];
    if (cfg[CFG_USE_BUTTON_IN].is<bool>()) c.useButtonInput = cfg[CFG_USE_BUTTON_IN];
    if (cfg[CFG_USE_KLINE_OUT].is<bool>()) c.useKlineOutput = cfg[CFG_USE_KLINE_OUT];
    if (cfg[CFG_USE_CAN_OUT].is<bool>())   c.useCanOutput   = cfg[CFG_USE_CAN_OUT];
    if (cfg[CFG_USE_DPOT_OUT].is<bool>())  c.useDpotOutput  = cfg[CFG_USE_DPOT_OUT];
    if (cfg[CFG_USE_RELAY_OUT].is<bool>()) c.useRelayOutput = cfg[CFG_USE_RELAY_OUT];

    if (cfg[CFG_ACTIVE_PROTO].is<long>()) {
        long p = cfg[CFG_ACTIVE_PROTO];
        if (p != PROTO_KLINE && p != PROTO_CAN) { sendErr(id, ERR_OUT_OF_RANGE, "activeProtocol 0..1"); return false; }
        c.activeProtocol = (uint8_t) p;
    }
    if (cfg[CFG_OCS_CAN_ID1].is<long>()) {
        long v = cfg[CFG_OCS_CAN_ID1];
        if (v < 0 || v > 0x1FFFFFFF) { sendErr(id, ERR_OUT_OF_RANGE, "ocsCanId1"); return false; }
        c.ocsCanId1 = (uint32_t) v;
    }
    if (cfg[CFG_OCS_CAN_ID2].is<long>()) {
        long v = cfg[CFG_OCS_CAN_ID2];
        if (v < 0 || v > 0x1FFFFFFF) { sendErr(id, ERR_OUT_OF_RANGE, "ocsCanId2"); return false; }
        c.ocsCanId2 = (uint32_t) v;
    }
    if (cfg[CFG_PID_SEATBELT].is<long>()) {
        long v = cfg[CFG_PID_SEATBELT];
        if (v < 0 || v > 0xFF) { sendErr(id, ERR_OUT_OF_RANGE, "pidSeatbeltStatus 0..255"); return false; }
        c.pidSeatbeltStatus = (uint8_t) v;
    }
    if (cfg[CFG_PID_PASSENGER].is<long>()) {
        long v = cfg[CFG_PID_PASSENGER];
        if (v < 0 || v > 0xFF) { sendErr(id, ERR_OUT_OF_RANGE, "pidPassengerType 0..255"); return false; }
        c.pidPassengerType = (uint8_t) v;
    }

    // DPOT positions must be 0..99
    const char *dpotKeys[3] = { CFG_DPOT_OFF, CFG_DPOT_CHILD, CFG_DPOT_ADULT };
    uint8_t *dpotDst[3] = { &c.dpotPositionOff, &c.dpotPositionChild, &c.dpotPositionAdult };
    for (uint8_t i = 0; i < 3; i++) {
        if (cfg[dpotKeys[i]].is<long>()) {
            long v = cfg[dpotKeys[i]];
            if (v < 0 || v > 99) { sendErr(id, ERR_OUT_OF_RANGE, "dpotPosition 0..99"); return false; }
            *dpotDst[i] = (uint8_t) v;
        }
    }

    g_config = c;
    return true;
}

// ---------------------------------------------------------------------------
// Event senders
// ---------------------------------------------------------------------------

void EspLink::publishState(const PassengerState &state, bool overrideActive) {
    JsonDocument doc;
    doc[KEY_TYPE] = MSG_STATE;
    doc[KEY_BUCKLED] = state.isBuckled();
    doc[KEY_PASSENGER_TYPE] = (int) state.getPassengerType();
    doc[KEY_OVERRIDE] = overrideActive;
    doc[KEY_LINK_KLINE] = kLineInput.isInitialized() ? LINK_OK : LINK_DOWN;
    doc[KEY_LINK_CAN]   = canHandler.isInitialized() ? LINK_OK : LINK_DOWN;
    doc[KEY_TS] = millis();
    emit(doc);
}

void EspLink::sendConfig() {
    JsonDocument doc;
    doc[KEY_TYPE] = MSG_CONFIG;
    JsonObject cfg = doc[KEY_CFG].to<JsonObject>();
    cfg[CFG_USE_KLINE_IN]  = g_config.useKlineInput;
    cfg[CFG_USE_CAN_IN]    = g_config.useCanInput;
    cfg[CFG_USE_BUTTON_IN] = g_config.useButtonInput;
    cfg[CFG_USE_KLINE_OUT] = g_config.useKlineOutput;
    cfg[CFG_USE_CAN_OUT]   = g_config.useCanOutput;
    cfg[CFG_USE_DPOT_OUT]  = g_config.useDpotOutput;
    cfg[CFG_USE_RELAY_OUT] = g_config.useRelayOutput;
    cfg[CFG_ACTIVE_PROTO]  = g_config.activeProtocol;
    cfg[CFG_OCS_CAN_ID1]   = g_config.ocsCanId1;
    cfg[CFG_OCS_CAN_ID2]   = g_config.ocsCanId2;
    cfg[CFG_PID_SEATBELT]  = g_config.pidSeatbeltStatus;
    cfg[CFG_PID_PASSENGER] = g_config.pidPassengerType;
    cfg[CFG_DPOT_OFF]      = g_config.dpotPositionOff;
    cfg[CFG_DPOT_CHILD]    = g_config.dpotPositionChild;
    cfg[CFG_DPOT_ADULT]    = g_config.dpotPositionAdult;
    cfg[CFG_VERSION]       = g_config.version;
    emit(doc);
}

void EspLink::sendAck(long id) {
    JsonDocument doc;
    doc[KEY_TYPE] = MSG_ACK;
    doc[KEY_ID] = id;
    emit(doc);
}

void EspLink::sendErr(long id, const char *code, const char *msgText) {
    JsonDocument doc;
    doc[KEY_TYPE] = MSG_ERR;
    doc[KEY_ID] = id;
    doc[KEY_CODE] = code;
    doc[KEY_MSG] = msgText;
    emit(doc);
}
