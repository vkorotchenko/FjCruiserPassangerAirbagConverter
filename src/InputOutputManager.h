#ifndef INPUT_OUTPUT_MANAGER_H_
#define INPUT_OUTPUT_MANAGER_H_

#include <Arduino.h>
#include "config.h"
#include "PassengerState.h"
#include "PassengerStateInput.h"
#include "PassengerStateOutput.h"

#if USE_KLINE_INPUT
#include "KLineInput.h"
#endif

#if USE_KLINE_OUTPUT
#include "KLineOutput.h"
#endif

#if USE_CAN_INPUT || USE_CAN_OUTPUT
#include "CanHandler.h"
#endif

#if USE_BUTTON_INPUT
#include "ButtonHandler.h"
#endif

#if USE_DPOT_OUTPUT
#include "digital_pot.h"
#endif

#if USE_RELAY_OUTPUT
#include "SeatbeltRelay.h"
#endif

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
    // Arrays to store active inputs and outputs
    PassengerStateInput* inputs[3];    // Max 3 inputs (K-line, CAN, Button)
    PassengerStateOutput* outputs[4];  // Max 4 outputs (K-line, CAN, DigitalPot, Relay)

    uint8_t inputCount;
    uint8_t outputCount;

    void initializeInputs();
    void initializeOutputs();
};

extern InputOutputManager ioManager;

#endif /* INPUT_OUTPUT_MANAGER_H_ */
