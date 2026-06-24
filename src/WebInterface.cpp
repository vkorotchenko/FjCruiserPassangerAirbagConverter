#include "WebInterface.h"

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <AsyncJson.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>

#include "config.h"
#include "control_protocol.h"
#include "EspLink.h"
#include "RuntimeConfig.h"
#include "PassengerState.h"

WebInterface webInterface;

static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");
static Preferences wifiPrefs;

// EspLink sender: broadcast a rendered event line to all WebSocket clients.
static void wsSend(const char *line) {
    ws.textAll(line);
}

static void onWsEvent(AsyncWebSocket *srv, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
    case WS_EVT_CONNECT:
        // Greet the (re)connecting UI with the current config + state.
        espLink.sendConfig();
        espLink.publishState(passengerState, g_config.overrideEnabled);
        break;
    case WS_EVT_DATA: {
        AwsFrameInfo *info = (AwsFrameInfo *) arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
            // NUL-terminate and hand to the control engine.
            static char buf[CONTROL_LINE_MAX];
            size_t n = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
            memcpy(buf, data, n);
            buf[n] = '\0';
            espLink.handleLine(buf);
        }
        break;
    }
    default:
        break;
    }
}

static void startWifi() {
    WiFi.mode(WIFI_AP_STA);
    WiFi.setHostname(WIFI_HOSTNAME);
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS);

    wifiPrefs.begin("wifi", true);
    String ssid = wifiPrefs.getString("ssid", "");
    String pass = wifiPrefs.getString("pass", "");
    wifiPrefs.end();
    if (ssid.length()) {
        WiFi.begin(ssid.c_str(), pass.c_str());
    }
}

static void setupRoutes() {
    server.on("/api/info", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        doc["hostname"]  = WIFI_HOSTNAME;
        doc["fwVersion"] = FIRMWARE_VERSION;
        doc["apIp"]      = WiFi.softAPIP().toString();
        doc["staIp"]     = WiFi.localIP().toString();
        doc["staOk"]     = WiFi.isConnected();
        doc["clients"]   = ws.count();
        String out;
        serializeJson(doc, out);
        req->send(200, "application/json", out);
    });

    // Save WiFi STA credentials to NVS, then (re)connect.
    AsyncCallbackJsonWebHandler *wifiHandler =
        new AsyncCallbackJsonWebHandler("/api/wifi", [](AsyncWebServerRequest *req, JsonVariant &json) {
            JsonObject body = json.as<JsonObject>();
            String ssid = body["ssid"] | "";
            String pass = body["pass"] | "";
            if (!ssid.length()) { req->send(400, "application/json", "{\"ok\":false,\"err\":\"ssid required\"}"); return; }
            wifiPrefs.begin("wifi", false);
            wifiPrefs.putString("ssid", ssid);
            wifiPrefs.putString("pass", pass);
            wifiPrefs.end();
            WiFi.disconnect();
            WiFi.begin(ssid.c_str(), pass.c_str());
            req->send(200, "application/json", "{\"ok\":true}");
        });
    server.addHandler(wifiHandler);

    server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
    server.onNotFound([](AsyncWebServerRequest *req) {
        if (LittleFS.exists("/index.html")) {
            req->send(LittleFS, "/index.html", "text/html");
        } else {
            req->send(404, "text/plain", "Web UI not flashed (run 'pio run -t uploadfs').");
        }
    });
}

void WebInterface::setup() {
    if (!LittleFS.begin(true)) {
        Logger::info("WebInterface: LittleFS mount failed");
    }

    startWifi();

    espLink.setSender(wsSend);     // route EspLink events to WebSocket clients
    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    setupRoutes();
    server.begin();

    Logger::info("WebInterface: AP '%s' at %s", WIFI_AP_SSID, WiFi.softAPIP().toString().c_str());
}

void WebInterface::loop() {
    ws.cleanupClients();
}
