#ifndef PASSENGER_STATE_OUTPUT_H_
#define PASSENGER_STATE_OUTPUT_H_

#include "PassengerState.h"

/**
 * Interface for classes that can output/act on passenger state
 * (e.g., CAN bus, K-line, digital potentiometer)
 */
class PassengerStateOutput {
public:
    virtual ~PassengerStateOutput() {}

    /**
     * Apply the passenger state to the output device
     * Called when state changes or periodically as needed
     */
    virtual void applyState(const PassengerState& state) = 0;

    /**
     * Check if output device is ready/initialized
     */
    virtual bool isOutputReady() = 0;
};

#endif /* PASSENGER_STATE_OUTPUT_H_ */
