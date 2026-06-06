#ifndef ESP_LINK_H_
#define ESP_LINK_H_

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "control_protocol.h"
#include "Logger.h"
#include "PassengerState.h"

/*
 * EspLink: the control-protocol engine for the converter.
 *
 * Speaks the newline-JSON protocol in include/control_protocol.h. On the
 * single-board ESP32 V2 it runs in-process: the WebInterface feeds incoming
 * WebSocket text to handleLine(), and EspLink emits events back through a
 * line-sender callback (ws.textAll). It:
 *   - parses commands (get/set_config, get_state, set_override, start/stop_capture, reset)
 *   - emits events (state, log, frame, ack/err)
 *   - acts as a Logger sink so log lines reach the web UI
 *   - buffers logs and captured frames in fixed rings, flushed with a per-poll
 *     budget so a busy bus can never block the control loop
 *
 * Enqueue paths (LogSink + capture hooks) never send directly; poll() drains.
 */

// One captured bus frame awaiting forwarding.
struct CapturedFrame {
    uint8_t  bus;        // 0 = CAN, 1 = K-line
    uint32_t id;         // CAN id, or K-line PID
    uint8_t  mode;       // K-line OBD mode (0 for CAN)
    bool     ext;        // CAN extended-id flag
    uint8_t  len;
    uint8_t  data[8];
    uint32_t ts;
};

// Sink for fully-rendered JSON lines (without newline framing); set by WebInterface.
typedef void (*LineSender)(const char *line);

class EspLink : public LogSink {
public:
    EspLink();

    void setup();
    void poll();   // call every loop(): drain the log + frame rings

    // Where rendered event lines go (e.g. ws.textAll). Required before sending.
    void setSender(LineSender s) { sender = s; }

    // Handle one inbound command line (called by the WebSocket handler).
    void handleLine(const char *line);

    // Publish a passenger-state snapshot (call when state changes).
    void publishState(const PassengerState &state, bool overrideActive);
    // Emit the current config (e.g. to greet a freshly-connected client).
    void sendConfig();

    // Capture hooks, called by the bus handlers. Cheap: enqueue only.
    bool capturingCan()   const { return captureCan; }
    bool capturingKline() const { return captureKline; }
    void captureCanFrame(uint32_t id, bool ext, const uint8_t *data, uint8_t len);
    void captureKlineFrame(uint8_t mode, uint8_t pid, const uint8_t *data, uint8_t len);

    // LogSink: enqueue a formatted line (non-blocking).
    void writeLine(int level, const char *line) override;

private:
    LineSender sender;

    // ---- capture state ----
    bool captureCan;
    bool captureKline;

    // ---- log ring ----
    char    logRing[ESP_LINK_LOG_RING][ESP_LINK_LOG_LINE];
    int8_t  logLevelRing[ESP_LINK_LOG_RING];
    uint8_t logHead, logCount;

    // ---- frame ring ----
    CapturedFrame frameRing[ESP_LINK_FRAME_RING];
    uint8_t frameHead, frameCount;

    void emit(JsonDocument &doc);        // serialize + hand to sender
    void drainLogs(uint8_t budget);
    void drainFrames(uint8_t budget);

    void sendAck(long id);
    void sendErr(long id, const char *code, const char *msgText);
    // Validate + merge a partial config object. Returns false (and sends err) on reject.
    bool applyConfig(JsonObjectConst cfg, long id);
};

extern EspLink espLink;

#endif // ESP_LINK_H_
