#ifndef HANDLER_H_
#define HANDLER_H_

/**
 * Base interface for all handlers that need periodic processing
 * Provides a common interface for polymorphic processing in the main loop
 */
class Handler {
public:
    virtual ~Handler() {}

    /**
     * Main processing method called from the main loop
     * Each handler implements its own processing logic
     */
    virtual void process() = 0;

    /**
     * Setup/initialization method
     * Called once during system startup
     */
    virtual void setup() = 0;
};

#endif /* HANDLER_H_ */
