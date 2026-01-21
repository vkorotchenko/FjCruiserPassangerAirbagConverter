#ifndef SEATBELT_RELAY_H_
#define SEATBELT_RELAY_H_

#include <Arduino.h>
#include "config.h"
#include "Logger.h"
#include "PassengerStateOutput.h"

/**
 * Relay output handler that controls a relay based on seatbelt state
 * Relay turns ON when seatbelt is buckled, OFF when not buckled
 */
class SeatbeltRelay : public PassengerStateOutput {
public:
    SeatbeltRelay();

    // Initialization
    void setup();

    // PassengerStateOutput interface
    void applyState(const PassengerState& state) override;
    bool isOutputReady() override;

    // Direct control methods
    void setRelayState(bool on);
    bool getRelayState() const;

private:
    uint8_t relayPin;
    bool relayState;  // Current relay state (true = ON, false = OFF)
    bool activeHigh;  // Relay activation logic

    void writeRelayPin(bool on);
};

extern SeatbeltRelay seatbeltRelay;

#endif /* SEATBELT_RELAY_H_ */
