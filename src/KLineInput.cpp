#include "KLineInput.h"
#include "RuntimeConfig.h"
#include "EspLink.h"

// Global singleton instance
KLineInput kLineInput = KLineInput();

// Active only when K-line input is enabled at runtime.
bool KLineInput::isActive() {
    return g_config.useKlineInput;
}

// Constructor
KLineInput::KLineInput()
    : initialized(false)
    , lastResponseLength(0)
    , lastCommunicationTime(0)
{
}

// Setup - Initialize serial port and pins
void KLineInput::setup() {
    Logger::info("K-line Input: Initializing...");

    // Configure K-line serial port with pins
    obd.begin(Serial1, KLINE_RX_PIN, KLINE_TX_PIN);

    Logger::info("K-line Input: Serial port configured on pins RX=%d, TX=%d", KLINE_RX_PIN, KLINE_TX_PIN);
}

// Check initialization status
bool KLineInput::isInitialized() {
    return initialized;
}

// Initialize K-line protocol (ISO 9141-2)
bool KLineInput::initProtocol() {
    Logger::info("K-line Input: Starting ISO 9141-2 initialization...");

    // Retry initialization multiple times
    for (int attempt = 1; attempt <= KLINE_INIT_RETRIES; attempt++) {
        Logger::debug("K-line Input: Init attempt %d/%d", attempt, KLINE_INIT_RETRIES);

        // Wait before initialization attempt
        if (attempt > 1) {
            delay(KLINE_INIT_DELAY);
        }

        // Attempt ISO 9141-2 initialization
        if (obd.init()) {
            initialized = true;
            lastCommunicationTime = millis();
            Logger::info("K-line Input: Initialization successful!");
            return true;
        }

        Logger::debug("K-line Input: Init attempt %d failed", attempt);
    }

    Logger::info("K-line Input: Initialization failed after %d attempts", KLINE_INIT_RETRIES);
    initialized = false;
    return false;
}

// Send request with fixed expected response length
bool KLineInput::sendRequest(uint8_t* data, uint8_t length, uint8_t expectedResponseLength) {
    if (!initialized) {
        Logger::debug("K-line Input: Cannot send request - not initialized");
        return false;
    }

    logMessage("K-line Input TX", data, length);

    bool success = obd.request(data, length, expectedResponseLength);

    if (success) {
        lastResponseLength = expectedResponseLength;
        lastCommunicationTime = millis();

        // Log response
        const uint8_t* response = getResponseBuffer();
        logMessage("K-line Input RX", (uint8_t*)response, expectedResponseLength);
    } else {
        Logger::debug("K-line Input: Request failed");
        lastResponseLength = 0;
    }

    return success;
}

// Send request with variable response length
bool KLineInput::sendRequestVariable(uint8_t* data, uint8_t length) {
    if (!initialized) {
        Logger::debug("K-line Input: Cannot send request - not initialized");
        return false;
    }

    logMessage("K-line Input TX", data, length);

    uint8_t responseLength = obd.request(data, length);

    if (responseLength > 0) {
        lastResponseLength = responseLength;
        lastCommunicationTime = millis();

        // Log response
        const uint8_t* response = getResponseBuffer();
        logMessage("K-line Input RX", (uint8_t*)response, responseLength);
        return true;
    } else {
        Logger::debug("K-line Input: Request failed");
        lastResponseLength = 0;
        return false;
    }
}

// Read PID with specific mode
bool KLineInput::readPID(uint8_t pid, uint8_t mode, uint8_t expectedLength) {
    if (!initialized) {
        Logger::debug("K-line Input: Cannot read PID - not initialized");
        return false;
    }

    Logger::debug("K-line Input: Reading PID 0x%X (mode 0x%X)", pid, mode);

    bool success = obd.getPID(pid, mode, expectedLength);

    if (success) {
        lastResponseLength = expectedLength;
        lastCommunicationTime = millis();

        // Forward the response to the web UI when K-line capture is on.
        if (espLink.capturingKline()) {
            espLink.captureKlineFrame(mode, pid, getResponseBuffer(), expectedLength);
        }
    } else {
        Logger::debug("K-line Input: PID read failed");
        lastResponseLength = 0;
    }

    return success;
}

// Read single byte from response
uint8_t KLineInput::readByte(uint8_t index) {
    return obd.readUint8(index);
}

// Read word (16-bit) from response
uint16_t KLineInput::readWord(uint8_t index) {
    return obd.readUint16();
}

// Read double word (32-bit) from response
uint32_t KLineInput::readDWord(uint8_t index) {
    return obd.readUint32();
}

// Get last response length
uint8_t KLineInput::getLastResponseLength() {
    return lastResponseLength;
}

// Get pointer to response buffer
const uint8_t* KLineInput::getResponseBuffer() {
    // OBD9141 stores response in internal buffer starting at index 4
    // We return the buffer via readBuffer method
    static uint8_t buffer[16];
    for (uint8_t i = 0; i < 16; i++) {
        buffer[i] = obd.readBuffer(i);
    }
    return buffer;
}

// Main processing loop
void KLineInput::process() {
    // Check for communication timeout
    if (initialized && (millis() - lastCommunicationTime > KLINE_TIMEOUT)) {
        Logger::debug("K-line Input: Communication timeout detected");
        // Could attempt re-initialization here if needed
    }

    // Add any periodic processing here
}

// Log K-line message in hex format
void KLineInput::logMessage(const char* prefix, uint8_t* data, uint8_t length) {
    if (length == 0) return;

    char logBuffer[128];
    int offset = 0;

    // Add prefix
    offset += snprintf(logBuffer + offset, sizeof(logBuffer) - offset, "%s: ", prefix);

    // Add hex bytes
    for (uint8_t i = 0; i < length && i < 16; i++) {
        offset += snprintf(logBuffer + offset, sizeof(logBuffer) - offset, "%02X ", data[i]);
    }

    Logger::debug("%s", logBuffer);
}

// PassengerStateInput interface implementation
void KLineInput::processInput(PassengerState& state) {
    // TODO: Implement K-line reading logic to update passenger state
    // This would read sensor data from K-line and update the state accordingly
    // For now, this is a placeholder for future implementation
}

bool KLineInput::isInputReady() {
    return initialized;
}
