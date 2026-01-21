#include "InputOutputManager.h"
#include "Logger.h"

// Global singleton instance
InputOutputManager ioManager;

InputOutputManager::InputOutputManager()
    : inputCount(0)
    , outputCount(0)
{
    // Initialize arrays to null
    for (uint8_t i = 0; i < 3; i++) {
        inputs[i] = nullptr;
    }
    for (uint8_t i = 0; i < 4; i++) {
        outputs[i] = nullptr;
    }

    initializeInputs();
    initializeOutputs();
}

void InputOutputManager::initializeInputs() {
    Logger::info("IO Manager: Initializing inputs...");

#if USE_KLINE_INPUT
    inputs[inputCount++] = &kLineHandler;
    Logger::info("IO Manager: K-line input enabled");
#endif

#if USE_CAN_INPUT
    inputs[inputCount++] = &canHandler;
    Logger::info("IO Manager: CAN input enabled");
#endif

#if USE_BUTTON_INPUT
    inputs[inputCount++] = &buttonHandler;
    Logger::info("IO Manager: Button input enabled");
#endif

    Logger::info("IO Manager: %d input source(s) configured", inputCount);
}

void InputOutputManager::initializeOutputs() {
    Logger::info("IO Manager: Initializing outputs...");

#if USE_KLINE_OUTPUT
    outputs[outputCount++] = &kLineHandler;
    Logger::info("IO Manager: K-line output enabled");
#endif

#if USE_CAN_OUTPUT
    outputs[outputCount++] = &canHandler;
    Logger::info("IO Manager: CAN output enabled");
#endif

#if USE_DPOT_OUTPUT
    outputs[outputCount++] = &digitalPotHandler;
    Logger::info("IO Manager: Digital Pot output enabled");
#endif

#if USE_RELAY_OUTPUT
    outputs[outputCount++] = &seatbeltRelay;
    Logger::info("IO Manager: Relay output enabled");
#endif

    Logger::info("IO Manager: %d output target(s) configured", outputCount);
}

void InputOutputManager::processInputs(PassengerState& state) {
    for (uint8_t i = 0; i < inputCount; i++) {
        if (inputs[i] != nullptr && inputs[i]->isInputReady()) {
            inputs[i]->processInput(state);
        }
    }
}

void InputOutputManager::applyOutputs(const PassengerState& state) {
    for (uint8_t i = 0; i < outputCount; i++) {
        if (outputs[i] != nullptr && outputs[i]->isOutputReady()) {
            outputs[i]->applyState(state);
        }
    }
}

bool InputOutputManager::hasReadyInput() {
    for (uint8_t i = 0; i < inputCount; i++) {
        if (inputs[i] != nullptr && inputs[i]->isInputReady()) {
            return true;
        }
    }
    return false;
}

bool InputOutputManager::hasReadyOutput() {
    for (uint8_t i = 0; i < outputCount; i++) {
        if (outputs[i] != nullptr && outputs[i]->isOutputReady()) {
            return true;
        }
    }
    return false;
}
