#include "SeatbeltRelay.h"

// Global singleton instance
SeatbeltRelay seatbeltRelay;

SeatbeltRelay::SeatbeltRelay()
    : relayPin(RELAY_PIN)
    , relayState(false)
    , activeHigh(RELAY_ACTIVE_HIGH)
{
}

void SeatbeltRelay::setup() {
    Logger::info("Relay: Initializing on pin %d", relayPin);

    // Configure relay pin as output
    pinMode(relayPin, OUTPUT);

    // Set initial state to OFF
    setRelayState(false);

    Logger::info("Relay: Configured as %s (pin %d)",
                 activeHigh ? "ACTIVE_HIGH" : "ACTIVE_LOW",
                 relayPin);
}

void SeatbeltRelay::applyState(const PassengerState& state) {
    // Relay turns ON when seatbelt is buckled, OFF when not buckled
    bool shouldBeOn = state.isBuckled();

    if (shouldBeOn != relayState) {
        setRelayState(shouldBeOn);
        Logger::info("Relay: State changed to %s (buckled: %d)",
                     shouldBeOn ? "ON" : "OFF",
                     state.isBuckled());
    }
}

bool SeatbeltRelay::isOutputReady() {
    return true;  // Relay is always ready once setup is called
}

void SeatbeltRelay::setRelayState(bool on) {
    relayState = on;
    writeRelayPin(on);
    Logger::debug("Relay: Set to %s", on ? "ON" : "OFF");
}

bool SeatbeltRelay::getRelayState() const {
    return relayState;
}

void SeatbeltRelay::writeRelayPin(bool on) {
    // Write to pin based on active high/low configuration
    if (activeHigh) {
        digitalWrite(relayPin, on ? HIGH : LOW);
    } else {
        digitalWrite(relayPin, on ? LOW : HIGH);
    }
}
