#ifndef CONTROL_PROTOCOL_H_
#define CONTROL_PROTOCOL_H_

/*
 * control_protocol.h
 *
 * Shared wire-protocol contract for the link between the Feather M0 (converter)
 * and the ESP32 (WiFi bridge + web host). Compiled into BOTH PlatformIO envs.
 *
 * Transport: newline-delimited JSON, one object per line, 115200 8N1.
 *   M0 <--UART--> ESP32 <--WebSocket (verbatim)--> Browser
 *
 * Every message carries a string type tag under key "t". Commands may carry a
 * numeric "id" which is echoed back in the matching "ack"/"err".
 *
 * This header only defines the *names* (type tags + field keys) so both sides
 * agree on spelling, plus a couple of tiny enums. Message construction/parsing
 * lives in EspLink (M0) and the ESP32 bridge, using ArduinoJson.
 */

// ---- Message type tags (key "t") ----------------------------------------
// Commands: ESP32 -> M0
#define MSG_GET_CONFIG     "get_config"
#define MSG_SET_CONFIG     "set_config"
#define MSG_GET_STATE      "get_state"
#define MSG_SET_OVERRIDE   "set_override"
#define MSG_START_CAPTURE  "start_capture"
#define MSG_STOP_CAPTURE   "stop_capture"
#define MSG_RESET          "reset"

// Events: M0 -> ESP32
#define MSG_CONFIG         "config"
#define MSG_STATE          "state"
#define MSG_LOG            "log"
#define MSG_FRAME          "frame"
#define MSG_ACK            "ack"
#define MSG_ERR            "err"

// ---- Common field keys --------------------------------------------------
#define KEY_TYPE           "t"
#define KEY_ID             "id"
#define KEY_CODE           "code"
#define KEY_MSG            "msg"
#define KEY_TS             "ts"

// config object (KEY_CFG holds the RuntimeConfig fields below)
#define KEY_CFG            "cfg"
#define CFG_USE_KLINE_IN   "useKlineInput"
#define CFG_USE_CAN_IN     "useCanInput"
#define CFG_USE_BUTTON_IN  "useButtonInput"
#define CFG_USE_KLINE_OUT  "useKlineOutput"
#define CFG_USE_CAN_OUT    "useCanOutput"
#define CFG_USE_DPOT_OUT   "useDpotOutput"
#define CFG_USE_RELAY_OUT  "useRelayOutput"
#define CFG_ACTIVE_PROTO   "activeProtocol"
#define CFG_OCS_CAN_ID1    "ocsCanId1"
#define CFG_OCS_CAN_ID2    "ocsCanId2"
#define CFG_PID_SEATBELT   "pidSeatbeltStatus"
#define CFG_PID_PASSENGER  "pidPassengerType"
#define CFG_DPOT_OFF       "dpotPositionOff"
#define CFG_DPOT_CHILD     "dpotPositionChild"
#define CFG_DPOT_ADULT     "dpotPositionAdult"
#define CFG_VERSION        "version"

// state event / set_override
#define KEY_BUCKLED        "buckled"
#define KEY_PASSENGER_TYPE "passengerType"
#define KEY_OVERRIDE       "override"
#define KEY_ENABLED        "enabled"
#define KEY_LINK_KLINE     "linkKline"
#define KEY_LINK_CAN       "linkCan"
#define KEY_LINK_M0        "linkM0"

// log event
#define KEY_LEVEL          "lvl"

// frame event / start_capture
#define KEY_BUS            "bus"     // "can" | "kline"
#define KEY_SRC            "src"     // "can" | "kline" | "all"
#define KEY_FRAME_ID       "id"
#define KEY_EXT            "ext"     // CAN extended id flag
#define KEY_LEN            "len"
#define KEY_DATA           "data"    // array of bytes
#define KEY_MODE           "mode"    // K-line OBD mode
#define KEY_PID            "pid"     // K-line PID

// ---- Field value vocabularies ------------------------------------------
#define BUS_CAN            "can"
#define BUS_KLINE          "kline"
#define SRC_ALL            "all"

#define LINK_OK            "ok"
#define LINK_DOWN          "down"

#define LVL_INFO           "info"
#define LVL_DEBUG          "debug"

// error codes (KEY_CODE)
#define ERR_BAD_TYPE       "bad_type"
#define ERR_BAD_FIELD      "bad_field"
#define ERR_OUT_OF_RANGE   "out_of_range"
#define ERR_PARSE          "parse"

// ---- Shared enums -------------------------------------------------------
// Mirrors PassengerType in PassengerState.h; duplicated here so the ESP32
// firmware (which does not include the M0 sources) shares the same numbering.
enum ProtocolId {
    PROTO_KLINE = 0,
    PROTO_CAN   = 1
};

// Max bytes recommended for a single NL-JSON line on the wire. Both sides size
// their ArduinoJson documents and line buffers around this.
#define CONTROL_LINE_MAX   512

// UART baud for the M0 <-> ESP32 link. Shared so both firmwares stay in sync.
#define CONTROL_LINK_BAUD  115200

#endif // CONTROL_PROTOCOL_H_
