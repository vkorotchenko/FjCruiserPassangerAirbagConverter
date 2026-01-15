#ifndef DIGITAL_POT_H
#define DIGITAL_POT_H

#include <Arduino.h>
#include <X9C10X.h>
#include "Logger.h"
#include "config.h"
#include "PassengerStateOutput.h"

// Occupant states
enum OccupantState {
    OCCUPANT_OFF = 0,      // No occupant / empty seat
    OCCUPANT_CHILD = 1,    // Child weight (disable airbag)
    OCCUPANT_ADULT = 2     // Adult weight (enable airbag)
};

class DigitalPotHandler : public PassengerStateOutput {
public:
    DigitalPotHandler();

    // Initialization
    void setup();

    // Set occupant state (sets all 4 potentiometers)
    void setOccupantState(OccupantState state);

    // Set specific wiper position on all potentiometers (0-99)
    void setPosition(uint8_t position);

    // Set individual potentiometer position (0-3 for pot index, 0-99 for position)
    void setPositionIndividual(uint8_t potIndex, uint8_t position);

    // Get current state
    OccupantState getCurrentState();

    // PassengerStateOutput interface
    void applyState(const PassengerState& state) override;
    bool isOutputReady() override;

private:
    X9C10X pot1;  // Front Left
    X9C10X pot2;  // Front Right
    X9C10X pot3;  // Rear Left
    X9C10X pot4;  // Rear Right
    OccupantState currentState;
};

// Global singleton instance (following CanHandler pattern)
extern DigitalPotHandler digitalPotHandler;

#endif // DIGITAL_POT_H
