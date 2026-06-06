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

    /**
     * Whether this handler is currently enabled at runtime.
     * Gates process() in the main loop so a disabled handler does no work and
     * never touches its (possibly uninitialised) bus. Defaults to always-on;
     * handlers backed by a RuntimeConfig flag override this.
     */
    virtual bool isActive() { return true; }
};

#endif /* HANDLER_H_ */
