#ifndef INPUT_OUTPUT_MANAGER_H_
#define INPUT_OUTPUT_MANAGER_H_

#include <Arduino.h>
#include "config.h"
#include "PassengerState.h"
#include "PassengerStateInput.h"
#include "PassengerStateOutput.h"

// All handlers are compiled in unconditionally; activation is decided at
// runtime from RuntimeConfig (g_config) rather than compile-time #if.
#include "KLineInput.h"
#include "KLineOutput.h"
#include "CanHandler.h"
#include "ButtonHandler.h"
#include "digital_pot.h"
#include "SeatbeltRelay.h"

/**
 * Manages passenger state inputs and outputs based on configuration
 * Provides a unified interface to process all enabled input sources
 * and apply state to all enabled output targets
 */
class InputOutputManager {
public:
    InputOutputManager();

    void begin();
    /**
     * Process all enabled input sources and update passenger state
     * Call this regularly from the main loop
     */
    void processInputs(PassengerState& state);

    /**
     * Apply passenger state to all enabled output targets
     * Call this when state changes or periodically
     */
    void applyOutputs(const PassengerState& state);

    /**
     * Check if at least one input source is ready
     */
    bool hasReadyInput();

    /**
     * Check if at least one output target is ready
     */
    bool hasReadyOutput();

private:
    // Arrays to store registered inputs and outputs. Every input/output is
    // registered once; the parallel *Enabled arrays point at the RuntimeConfig
    // flag that gates each one at runtime.
    PassengerStateInput* inputs[3];        // K-line, CAN, Button
    const bool* inputEnabled[3];
    PassengerStateOutput* outputs[4];      // K-line, CAN, DigitalPot, Relay
    const bool* outputEnabled[4];

    uint8_t inputCount;
    uint8_t outputCount;

    void initializeInputs();
    void initializeOutputs();
};

extern InputOutputManager ioManager;

#endif /* INPUT_OUTPUT_MANAGER_H_ */
