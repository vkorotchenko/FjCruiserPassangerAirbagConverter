#include "ButtonHandler.h"
#include "RuntimeConfig.h"

// Global singleton instance
ButtonHandler buttonHandler;

// Active only when button input is enabled at runtime.
bool ButtonHandler::isActive() {
    return g_config.useButtonInput;
}

ButtonHandler::ButtonHandler()
    : buttonPin(BUTTON_PIN)
    , lastButtonState(BUTTON_ACTIVE_LOW ? HIGH : LOW)
    , currentButtonState(BUTTON_ACTIVE_LOW ? HIGH : LOW)
    , lastDebounceTime(0)
    , debounceDelay(BUTTON_DEBOUNCE_MS)
    , buttonPressed(false)
    , currentStateIndex(0)
    , stateChanged(false)
{
}

void ButtonHandler::setup() {
    Logger::info("Button: Initializing on pin %d", buttonPin);

    // Configure button pin with internal pull-up if active low
    if (BUTTON_ACTIVE_LOW) {
        pinMode(buttonPin, INPUT_PULLUP);
        Logger::debug("Button: Configured as INPUT_PULLUP (active LOW)");
    } else {
        pinMode(buttonPin, INPUT);
        Logger::debug("Button: Configured as INPUT (active HIGH)");
    }

    // Read initial button state
    currentButtonState = digitalRead(buttonPin);
    lastButtonState = currentButtonState;

    Logger::info("Button: Initialization complete");
}

void ButtonHandler::process() {
    bool buttonState = readDebouncedButton();

    // Detect button press (transition from not pressed to pressed)
    bool pressedNow = BUTTON_ACTIVE_LOW ? (buttonState == LOW) : (buttonState == HIGH);
    bool wasPressedBefore = buttonPressed;

    buttonPressed = pressedNow;

    // Trigger state change on rising edge (button was just pressed)
    if (pressedNow && !wasPressedBefore) {
        cycleState();
        Logger::info("Button: Pressed - cycled to state %d", currentStateIndex);
    }
}

bool ButtonHandler::readDebouncedButton() {
    bool reading = digitalRead(buttonPin);

    // If the button state changed (due to noise or actual press)
    if (reading != lastButtonState) {
        // Reset the debouncing timer
        lastDebounceTime = millis();
    }

    // If enough time has passed since the last change
    if ((millis() - lastDebounceTime) > debounceDelay) {
        // If the button state has changed and is stable
        if (reading != currentButtonState) {
            currentButtonState = reading;
        }
    }

    lastButtonState = reading;
    return currentButtonState;
}

void ButtonHandler::cycleState() {
    currentStateIndex = (currentStateIndex + 1) % 3;
    stateChanged = true;
}

void ButtonHandler::processInput(PassengerState& state) {
    if (stateChanged) {
        switch (currentStateIndex) {
            case 0:
                // State 1: No passenger, not buckled
                state.setPassengerType(NO_PASSENGER);
                state.setBuckled(false);
                Logger::info("Button: State -> No passenger, not buckled");
                break;

            case 1:
                // State 2: Child, buckled
                state.setPassengerType(CHILD);
                state.setBuckled(true);
                Logger::info("Button: State -> Child, buckled");
                break;

            case 2:
                // State 3: Adult, buckled
                state.setPassengerType(ADULT);
                state.setBuckled(true);
                Logger::info("Button: State -> Adult, buckled");
                break;
        }

        stateChanged = false;
    }
}

bool ButtonHandler::isInputReady() {
    return true;  // Button is always ready once setup is called
}
