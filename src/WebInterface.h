#ifndef WEB_INTERFACE_H_
#define WEB_INTERFACE_H_

/*
 * WebInterface: WiFi + HTTP + WebSocket host for the converter.
 *
 * Runs on the same ESP32 as the converter. Serves the single-page app from
 * LittleFS and bridges the WebSocket to the in-process control engine (EspLink):
 *   - incoming WS text  -> espLink.handleLine()
 *   - EspLink events     -> ws.textAll() (registered as the EspLink sender)
 *
 * WiFi is AP-by-default with optional STA credentials saved in NVS. Only the
 * WiFi credentials live here; all converter config is owned by RuntimeConfig.
 */
class WebInterface {
public:
    void setup();
    void loop();
};

extern WebInterface webInterface;

#endif // WEB_INTERFACE_H_
