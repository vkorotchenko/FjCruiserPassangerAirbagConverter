#include "KLineOutput.h"
#include "RuntimeConfig.h"

// Global singleton instance
KLineOutput kLineOutput = KLineOutput();

// Active only when K-line output is enabled at runtime.
bool KLineOutput::isActive() {
    return g_config.useKlineOutput;
}

// Constructor
KLineOutput::KLineOutput()
{
}

// Setup - Initialize simulator
void KLineOutput::setup() {
    Logger::info("K-line Output: Initializing simulator...");

    // Initialize simulator mode for responding to requests
    obdSim.begin(Serial1, KLINE_RX_PIN, KLINE_TX_PIN);
    obdSim.keep_init_state(true);
    obdSim.initialize();

    // Set initial answers (default: no passenger, unbuckled)
    obdSim.setAnswer(0x01, PID_SEATBELT_STATUS, (uint8_t)0);
    obdSim.setAnswer(0x01, PID_PASSENGER_TYPE, (uint8_t)0);

    Logger::info("K-line Output: Simulator enabled with PIDs 0x%02X (seatbelt), 0x%02X (passenger type)",
                 PID_SEATBELT_STATUS, PID_PASSENGER_TYPE);
}

// Main processing loop
void KLineOutput::process() {
    // Process simulator - handles incoming requests and sends responses
    obdSim.loop();
}

// PassengerStateOutput interface implementation
void KLineOutput::applyState(const PassengerState& state) {
    // Store current state and update simulator answers
    currentState = state;
    updateSimulatorAnswers(state);

    Logger::debug("K-line Output: Updated simulator - Buckled: %d, Type: %d",
                  state.isBuckled(), state.getPassengerType());
}

bool KLineOutput::isOutputReady() {
    return true;  // Simulator is always ready to respond
}

// Update simulator answers based on passenger state
void KLineOutput::updateSimulatorAnswers(const PassengerState& state) {
    // Update seatbelt status (0 = unbuckled, 1 = buckled)
    uint8_t seatbeltStatus = state.isBuckled() ? 1 : 0;
    obdSim.setAnswer(0x01, PID_SEATBELT_STATUS, seatbeltStatus);

    // Update passenger type (0 = none, 1 = child, 2 = adult)
    uint8_t passengerType = (uint8_t)state.getPassengerType();
    obdSim.setAnswer(0x01, PID_PASSENGER_TYPE, passengerType);
}
