#ifndef PASSENGER_STATE_INPUT_H_
#define PASSENGER_STATE_INPUT_H_

#include "PassengerState.h"

/**
 * Interface for classes that can read passenger state from input sources
 * (e.g., CAN bus, K-line)
 */
class PassengerStateInput {
public:
    virtual ~PassengerStateInput() {}

    /**
     * Process input and update passenger state
     * Should be called regularly from main loop
     */
    virtual void processInput(PassengerState& state) = 0;

    /**
     * Check if input source is available/initialized
     */
    virtual bool isInputReady() = 0;
};

#endif /* PASSENGER_STATE_INPUT_H_ */
