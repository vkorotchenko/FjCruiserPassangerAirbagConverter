#include "k_line.h"
#include "config.h"

// Global singleton instance
KLineHandler kLineHandler = KLineHandler();

// Constructor
KLineHandler::KLineHandler()
    : initialized(false)
    , lastResponseLength(0)
    , lastCommunicationTime(0)
    , lastRequestTime(0)
{
}

// Setup - Initialize serial port and pins
void KLineHandler::setup() {
    Logger::info("K-line: Initializing...");

    // Configure K-line serial port with pins for both client and simulator
    obd.begin(Serial1, KLINE_RX_PIN, KLINE_TX_PIN);

    // Initialize simulator mode for responding to requests
    obdSim.begin(Serial1, KLINE_RX_PIN, KLINE_TX_PIN);
    obdSim.keep_init_state(true);
    obdSim.initialize();

    // Set initial answers (default: no passenger, unbuckled)
    obdSim.setAnswer(0x01, PID_SEATBELT_STATUS, (uint8_t)0);
    obdSim.setAnswer(0x01, PID_PASSENGER_TYPE, (uint8_t)0);

    Logger::info("K-line: Serial port configured on pins RX=%d, TX=%d", KLINE_RX_PIN, KLINE_TX_PIN);
    Logger::info("K-line: Simulator mode enabled with PIDs 0x%02X (seatbelt), 0x%02X (passenger type)",
                 PID_SEATBELT_STATUS, PID_PASSENGER_TYPE);
}

// Check initialization status
bool KLineHandler::isInitialized() {
    return initialized;
}

// Initialize K-line protocol (ISO 9141-2)
bool KLineHandler::initProtocol() {
    Logger::info("K-line: Starting ISO 9141-2 initialization...");

    // Retry initialization multiple times (like CanHandler)
    for (int attempt = 1; attempt <= KLINE_INIT_RETRIES; attempt++) {
        Logger::debug("K-line: Init attempt %d/%d", attempt, KLINE_INIT_RETRIES);

        // Wait before initialization attempt
        if (attempt > 1) {
            delay(KLINE_INIT_DELAY);
        }

        // Attempt ISO 9141-2 initialization
        if (obd.init()) {
            initialized = true;
            lastCommunicationTime = millis();
            Logger::info("K-line: Initialization successful!");
            return true;
        }

        Logger::debug("K-line: Init attempt %d failed", attempt);
    }

    Logger::info("K-line: Initialization failed after %d attempts", KLINE_INIT_RETRIES);
    initialized = false;
    return false;
}

// Send request with fixed expected response length
bool KLineHandler::sendRequest(uint8_t* data, uint8_t length, uint8_t expectedResponseLength) {
    if (!initialized) {
        Logger::debug("K-line: Cannot send request - not initialized");
        return false;
    }

    logMessage("K-line TX", data, length);

    bool success = obd.request(data, length, expectedResponseLength);

    if (success) {
        lastResponseLength = expectedResponseLength;
        lastCommunicationTime = millis();

        // Log response
        const uint8_t* response = getResponseBuffer();
        logMessage("K-line RX", (uint8_t*)response, expectedResponseLength);
    } else {
        Logger::debug("K-line: Request failed");
        lastResponseLength = 0;
    }

    return success;
}

// Send request with variable response length
bool KLineHandler::sendRequestVariable(uint8_t* data, uint8_t length) {
    if (!initialized) {
        Logger::debug("K-line: Cannot send request - not initialized");
        return false;
    }

    logMessage("K-line TX", data, length);

    uint8_t responseLength = obd.request(data, length);

    if (responseLength > 0) {
        lastResponseLength = responseLength;
        lastCommunicationTime = millis();

        // Log response
        const uint8_t* response = getResponseBuffer();
        logMessage("K-line RX", (uint8_t*)response, responseLength);
        return true;
    } else {
        Logger::debug("K-line: Request failed");
        lastResponseLength = 0;
        return false;
    }
}

// Read PID with specific mode
bool KLineHandler::readPID(uint8_t pid, uint8_t mode, uint8_t expectedLength) {
    if (!initialized) {
        Logger::debug("K-line: Cannot read PID - not initialized");
        return false;
    }

    Logger::debug("K-line: Reading PID 0x%X (mode 0x%X)", pid, mode);

    bool success = obd.getPID(pid, mode, expectedLength);

    if (success) {
        lastResponseLength = expectedLength;
        lastCommunicationTime = millis();
    } else {
        Logger::debug("K-line: PID read failed");
        lastResponseLength = 0;
    }

    return success;
}

// Read single byte from response
uint8_t KLineHandler::readByte(uint8_t index) {
    return obd.readUint8(index);
}

// Read word (16-bit) from response
uint16_t KLineHandler::readWord(uint8_t index) {
    return obd.readUint16();
}

// Read double word (32-bit) from response
uint32_t KLineHandler::readDWord(uint8_t index) {
    return obd.readUint32();
}

// Get last response length
uint8_t KLineHandler::getLastResponseLength() {
    return lastResponseLength;
}

// Get pointer to response buffer
const uint8_t* KLineHandler::getResponseBuffer() {
    // OBD9141 stores response in internal buffer starting at index 4
    // We return the buffer via readBuffer method
    static uint8_t buffer[16];
    for (uint8_t i = 0; i < 16; i++) {
        buffer[i] = obd.readBuffer(i);
    }
    return buffer;
}

// Main processing loop
void KLineHandler::process() {
    // Process simulator - handles incoming requests and sends responses
    obdSim.loop();

    // Check for communication timeout
    if (initialized && (millis() - lastCommunicationTime > KLINE_TIMEOUT)) {
        Logger::debug("K-line: Communication timeout detected");
        // Could attempt re-initialization here if needed
    }
}

// Log K-line message in hex format
void KLineHandler::logMessage(const char* prefix, uint8_t* data, uint8_t length) {
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
void KLineHandler::processInput(PassengerState& state) {
    // TODO: Implement K-line reading logic to update passenger state
    // This would read sensor data from K-line and update the state accordingly
    // For now, this is a placeholder for future implementation
}

bool KLineHandler::isInputReady() {
    return initialized;
}

// PassengerStateOutput interface implementation
void KLineHandler::applyState(const PassengerState& state) {
    // Store current state and update simulator answers
    currentState = state;
    updateSimulatorAnswers(state);

    Logger::debug("K-line: Updated simulator - Buckled: %d, Type: %d",
                  state.isBuckled(), state.getPassengerType());
}

bool KLineHandler::isOutputReady() {
    return true;  // Simulator is always ready to respond
}

// Update simulator answers based on passenger state
void KLineHandler::updateSimulatorAnswers(const PassengerState& state) {
    // Update seatbelt status (0 = unbuckled, 1 = buckled)
    uint8_t seatbeltStatus = state.isBuckled() ? 1 : 0;
    obdSim.setAnswer(0x01, PID_SEATBELT_STATUS, seatbeltStatus);

    // Update passenger type (0 = none, 1 = child, 2 = adult)
    uint8_t passengerType = (uint8_t)state.getPassengerType();
    obdSim.setAnswer(0x01, PID_PASSENGER_TYPE, passengerType);
}
