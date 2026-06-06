#include "InputOutputManager.h"
#include "RuntimeConfig.h"
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
        inputEnabled[i] = nullptr;
    }
    for (uint8_t i = 0; i < 4; i++) {
        outputs[i] = nullptr;
        outputEnabled[i] = nullptr;
    }
}

void InputOutputManager::begin() {
    initializeInputs();
    initializeOutputs();
}

void InputOutputManager::initializeInputs() {
    Logger::info("IO Manager: Registering inputs...");

    // Register every input once; runtime gating is via the enable pointer.
    inputs[inputCount] = &kLineInput;
    inputEnabled[inputCount] = &g_config.useKlineInput;
    inputCount++;

    inputs[inputCount] = &canHandler;
    inputEnabled[inputCount] = &g_config.useCanInput;
    inputCount++;

    inputs[inputCount] = &buttonHandler;
    inputEnabled[inputCount] = &g_config.useButtonInput;
    inputCount++;

    Logger::info("IO Manager: %d input source(s) registered", inputCount);
}

void InputOutputManager::initializeOutputs() {
    Logger::info("IO Manager: Registering outputs...");

    outputs[outputCount] = &kLineOutput;
    outputEnabled[outputCount] = &g_config.useKlineOutput;
    outputCount++;

    outputs[outputCount] = &canHandler;
    outputEnabled[outputCount] = &g_config.useCanOutput;
    outputCount++;

    outputs[outputCount] = &digitalPotHandler;
    outputEnabled[outputCount] = &g_config.useDpotOutput;
    outputCount++;

    outputs[outputCount] = &seatbeltRelay;
    outputEnabled[outputCount] = &g_config.useRelayOutput;
    outputCount++;

    Logger::info("IO Manager: %d output target(s) registered", outputCount);
}

void InputOutputManager::processInputs(PassengerState& state) {
    for (uint8_t i = 0; i < inputCount; i++) {
        if (inputs[i] != nullptr && *inputEnabled[i] && inputs[i]->isInputReady()) {
            inputs[i]->processInput(state);
        }
    }
}

void InputOutputManager::applyOutputs(const PassengerState& state) {
    for (uint8_t i = 0; i < outputCount; i++) {
        if (outputs[i] != nullptr && *outputEnabled[i] && outputs[i]->isOutputReady()) {
            outputs[i]->applyState(state);
        }
    }
}

bool InputOutputManager::hasReadyInput() {
    for (uint8_t i = 0; i < inputCount; i++) {
        if (inputs[i] != nullptr && *inputEnabled[i] && inputs[i]->isInputReady()) {
            return true;
        }
    }
    return false;
}

bool InputOutputManager::hasReadyOutput() {
    for (uint8_t i = 0; i < outputCount; i++) {
        if (outputs[i] != nullptr && *outputEnabled[i] && outputs[i]->isOutputReady()) {
            return true;
        }
    }
    return false;
}
