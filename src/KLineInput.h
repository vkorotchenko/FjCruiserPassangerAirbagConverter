#ifndef KLINE_INPUT_H
#define KLINE_INPUT_H

#include <Arduino.h>
#include <OBD9141.h>
#include "Logger.h"
#include "Handler.h"
#include "PassengerStateInput.h"
#include "config.h"

/**
 * K-line input handler - reads passenger state from K-line (OBD client mode)
 */
class KLineInput : public Handler, public PassengerStateInput {
public:
    KLineInput();

    // Initialization methods
    void setup() override;
    bool isInitialized();

    // Main processing loop (called from main loop)
    void process() override;

    // Protocol initialization (ISO 9141-2)
    bool initProtocol();

    // Message sending methods
    bool sendRequest(uint8_t* data, uint8_t length, uint8_t expectedResponseLength);
    bool sendRequestVariable(uint8_t* data, uint8_t length);

    // PID-based methods (for standard OBD requests)
    bool readPID(uint8_t pid, uint8_t mode, uint8_t expectedLength);

    // Data reading methods (read from last response)
    uint8_t readByte(uint8_t index = 0);
    uint16_t readWord(uint8_t index = 0);
    uint32_t readDWord(uint8_t index = 0);

    // Utility methods
    uint8_t getLastResponseLength();
    const uint8_t* getResponseBuffer();

    // PassengerStateInput interface
    void processInput(PassengerState& state) override;
    bool isInputReady() override;

private:
    OBD9141 obd;
    bool initialized;
    uint8_t lastResponseLength;
    unsigned long lastCommunicationTime;

    void logMessage(const char* prefix, uint8_t* data, uint8_t length);
};

// Global singleton instance
extern KLineInput kLineInput;

#endif // KLINE_INPUT_H
