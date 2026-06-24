#include "WebInterface.h"

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <AsyncJson.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <Update.h>
#include <ESPmDNS.h>

#include "config.h"
#include "control_protocol.h"
#include "EspLink.h"
#include "RuntimeConfig.h"
#include "PassengerState.h"

WebInterface webInterface;

static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");
static Preferences wifiPrefs;

// Set true when an OTA image has been written successfully; WebInterface::loop()
// reboots into the new firmware shortly after the HTTP response is flushed.
static volatile bool otaRebootPending = false;

// Pending WiFi credential change. The /api/wifi handler stashes the new values
// and sets the flag; WebInterface::loop() does the NVS write + reconnect in the
// main task. WiFi.begin()/disconnect() must NOT run inside an AsyncWebServer
// callback (AsyncTCP task) — doing so can stall the response and drop the
// client connection. Apply it from loop() instead, after the 200 is flushed.
static volatile bool wifiApplyPending = false;
static String pendingWifiSsid;
static String pendingWifiPass;

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
    // Log the home-network (STA) connection lifecycle so WiFi configuration is
    // visible in the serial/web log even with DEBUG output paused.
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        switch (event) {
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            Logger::info("WiFi: associated with home network, awaiting IP");
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            Logger::info("WiFi: joined home network, IP %s",
                         WiFi.localIP().toString().c_str());
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            Logger::info("WiFi: lost home network connection");
            break;
        case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
            Logger::info("WiFi: a device joined the setup AP");
            break;
        case ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED:
            Logger::info("WiFi: setup-AP client got IP %s",
                         IPAddress(info.wifi_ap_staipassigned.ip.addr).toString().c_str());
            break;
        case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
            Logger::info("WiFi: a device left the setup AP");
            break;
        default:
            break;
        }
    });

    WiFi.mode(WIFI_AP_STA);
    WiFi.setHostname(WIFI_HOSTNAME);
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASS);
    Logger::info("WiFi: AP '%s' up at %s", WIFI_AP_SSID,
                 WiFi.softAPIP().toString().c_str());

    wifiPrefs.begin("wifi", true);
    String ssid = wifiPrefs.getString("ssid", "");
    String pass = wifiPrefs.getString("pass", "");
    wifiPrefs.end();
    if (ssid.length()) {
        Logger::info("WiFi: connecting to saved network '%s'", ssid.c_str());
        WiFi.begin(ssid.c_str(), pass.c_str());
    } else {
        Logger::info("WiFi: no saved network; configure it from the app/web UI");
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
            IPAddress from = req->client() ? req->client()->remoteIP() : IPAddress(0, 0, 0, 0);
            Logger::info("WiFi: /api/wifi POST from %s", from.toString().c_str());
            if (!ssid.length()) { req->send(400, "application/json", "{\"ok\":false,\"err\":\"ssid required\"}"); return; }
            Logger::info("WiFi: received new credentials for '%s'", ssid.c_str());
            // Defer the NVS write + reconnect to loop() (see wifiApplyPending);
            // respond first so the client gets the 200 before the WiFi churn.
            pendingWifiSsid = ssid;
            pendingWifiPass = pass;
            wifiApplyPending = true;
            req->send(200, "application/json", "{\"ok\":true}");
        });
    server.addHandler(wifiHandler);

    // Firmware OTA: receive a new application image and flash it to the inactive
    // OTA partition. The image is validated by the Update library (magic byte +
    // size) and the client verifies its SHA256 before upload, so a corrupt or
    // interrupted transfer leaves the running firmware intact (rollback-safe).
    server.on(
        "/api/ota", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            bool ok = !Update.hasError();
            AsyncWebServerResponse *res = req->beginResponse(
                ok ? 200 : 500, "application/json",
                ok ? "{\"ok\":true}" : "{\"ok\":false,\"err\":\"flash failed\"}");
            res->addHeader("Connection", "close");
            req->send(res);
            if (ok) {
                otaRebootPending = true;  // loop() reboots after the response flushes
            }
        },
        [](AsyncWebServerRequest *req, const String &filename, size_t index,
           uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                Logger::info("OTA: receiving '%s'", filename.c_str());
                if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
                    Update.printError(Serial);
                }
            }
            if (Update.size() && Update.write(data, len) != len) {
                Update.printError(Serial);
            }
            if (final) {
                if (Update.end(true)) {
                    Logger::info("OTA: image written (%u bytes)", index + len);
                } else {
                    Update.printError(Serial);
                }
            }
        });

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

    // Advertise as "<hostname>.local" so the app can reach the converter on the
    // home network by name (no need to know its DHCP IP).
    if (MDNS.begin(WIFI_HOSTNAME)) {
        MDNS.addService("http", "tcp", 80);
        Logger::info("WebInterface: mDNS responder at %s.local", WIFI_HOSTNAME);
    }

    Logger::info("WebInterface: ready (firmware %s)", FIRMWARE_VERSION);
}

void WebInterface::loop() {
    ws.cleanupClients();

    if (wifiApplyPending) {
        wifiApplyPending = false;
        wifiPrefs.begin("wifi", false);
        wifiPrefs.putString("ssid", pendingWifiSsid);
        wifiPrefs.putString("pass", pendingWifiPass);
        wifiPrefs.end();
        Logger::info("WiFi: saved credentials to NVS; reconnecting to '%s'",
                     pendingWifiSsid.c_str());
        WiFi.disconnect();
        WiFi.begin(pendingWifiSsid.c_str(), pendingWifiPass.c_str());
    }

    if (otaRebootPending) {
        Logger::info("OTA: rebooting into new firmware");
        delay(200);  // let the HTTP response and log flush
        ESP.restart();
    }
}
