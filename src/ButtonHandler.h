#ifndef BUTTON_HANDLER_H_
#define BUTTON_HANDLER_H_

#include <Arduino.h>
#include "config.h"
#include "Logger.h"
#include "Handler.h"
#include "PassengerStateInput.h"

/**
 * Button input handler that cycles through passenger states
 * Each button press cycles through:
 * 1. No passenger, not buckled
 * 2. Child, buckled
 * 3. Adult, buckled
 */
class ButtonHandler : public Handler, public PassengerStateInput {
public:
    ButtonHandler();

    // Handler interface
    void setup() override;
    void process() override;
    bool isActive() override;

    // PassengerStateInput interface
    void processInput(PassengerState& state) override;
    bool isInputReady() override;

private:
    uint8_t buttonPin;
    bool lastButtonState;
    bool currentButtonState;
    unsigned long lastDebounceTime;
    unsigned long debounceDelay;
    bool buttonPressed;

    uint8_t currentStateIndex;  // 0, 1, or 2 for the three states
    bool stateChanged;

    bool readDebouncedButton();
    void cycleState();
};

extern ButtonHandler buttonHandler;

#endif /* BUTTON_HANDLER_H_ */
