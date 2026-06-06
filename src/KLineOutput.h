#ifndef KLINE_OUTPUT_H
#define KLINE_OUTPUT_H

#include <Arduino.h>
#include <OBD9141sim.h>
#include "Logger.h"
#include "Handler.h"
#include "PassengerStateOutput.h"
#include "config.h"

// Custom PIDs for passenger airbag system (Mode 0x01)
#define PID_SEATBELT_STATUS 0x60    // 0 = unbuckled, 1 = buckled
#define PID_PASSENGER_TYPE  0x61    // 0 = none, 1 = child, 2 = adult

/**
 * K-line output handler - responds to K-line requests (OBD simulator mode)
 */
class KLineOutput : public Handler, public PassengerStateOutput {
public:
    KLineOutput();

    // Initialization methods
    void setup() override;
    bool isActive() override;

    // Main processing loop (called from main loop)
    void process() override;

    // PassengerStateOutput interface
    void applyState(const PassengerState& state) override;
    bool isOutputReady() override;

private:
    OBD9141sim obdSim;
    PassengerState currentState;

    void updateSimulatorAnswers(const PassengerState& state);
};

// Global singleton instance
extern KLineOutput kLineOutput;

#endif // KLINE_OUTPUT_H
