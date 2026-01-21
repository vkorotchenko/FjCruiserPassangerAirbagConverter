#ifndef K_LINE_H
#define K_LINE_H

#include <Arduino.h>
#include <OBD9141.h>
#include <OBD9141sim.h>
#include "Logger.h"
#include "Handler.h"
#include "PassengerStateInput.h"
#include "PassengerStateOutput.h"

// Pin definitions (fixed per user requirements)
#define KLINE_RX_PIN 10
#define KLINE_TX_PIN 11

// Custom PIDs for passenger airbag system (Mode 0x01)
#define PID_SEATBELT_STATUS 0x60    // 0 = unbuckled, 1 = buckled
#define PID_PASSENGER_TYPE  0x61    // 0 = none, 1 = child, 2 = adult

class KLineHandler : public Handler, public PassengerStateInput, public PassengerStateOutput {
public:
    KLineHandler();

    // Initialization methods
    void setup() override;
    bool isInitialized();

    // Main processing loop (called from main loop)
    void process() override;

    // Protocol initialization (ISO 9141-2 only)
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

    // PassengerStateOutput interface
    void applyState(const PassengerState& state) override;
    bool isOutputReady() override;

private:
    OBD9141 obd;
    OBD9141sim obdSim;
    bool initialized;
    uint8_t lastResponseLength;
    unsigned long lastCommunicationTime;
    unsigned long lastRequestTime;
    PassengerState currentState;

    void logMessage(const char* prefix, uint8_t* data, uint8_t length);
    void updateSimulatorAnswers(const PassengerState& state);
};

// Global singleton instance (following CanHandler pattern)
extern KLineHandler kLineHandler;

#endif // K_LINE_H
