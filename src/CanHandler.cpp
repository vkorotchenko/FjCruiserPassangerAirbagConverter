/*
 * CanHandler.cpp
 *
 * Devices may register to this handler in order to receive CAN frames (publish/subscribe)
 * and they can also use this class to send messages.
 *
Copyright (c) 2013 Collin Kidder, Michael Neuweiler, Charles Galpin

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

 */

#include "CanHandler.h"

mcp2515_can CAN(SPI_CS_PIN); // Set CS pin
CanHandler canHandler = CanHandler();

/*
 * Constructor of the can handler
 */
CanHandler::CanHandler()
{
    masterID = 0x05;
    busSpeed = 0;
    initialized = false;
    lastTransmitTime = 0;
}

/*
 * Initialization of the CAN bus
 */
void CanHandler::setup()
{
    while (CAN_OK != CAN.begin(CAN_SPEED))
    {
        SERIAL_PORT_MONITOR.println("CAN init fail, retry...");
        delay(200);
    }

    initialized = true;
    Logger::info("CAN init ok. Speed = %i", CAN_500KBPS);
}

uint32_t CanHandler::getBusSpeed()
{
    return busSpeed;
}


/*
 * Logs the content of a received can frame
 *
 * \param frame - the received can frame to log
 */
void CanHandler::logFrame(CAN_FRAME &frame)
{
    if (Logger::isDebug())
    {
        Logger::debug("CAN: dlc=%X fid=%X id=%X ide=%X rtr=%X data=%X,%X,%X,%X,%X,%X,%X,%X",
                      frame.length, frame.fid, frame.id, frame.extended, frame.rtr,
                      frame.data.bytes[0], frame.data.bytes[1], frame.data.bytes[2], frame.data.bytes[3],
                      frame.data.bytes[4], frame.data.bytes[5], frame.data.bytes[6], frame.data.bytes[7]);
    }
}


/*
 * If a message is available, read it and forward it to registered observers.
 */
void CanHandler::process()
{
    static CAN_FRAME frame;

    unsigned char len = 8;
    unsigned char buf[8];

    if (CAN_MSGAVAIL == CAN.checkReceive())
    {
        CAN.readMsgBuf(&len, buf); // read data,  len: data length, buf: data buf

        frame.length = (uint8_t)len;
        for (int i = 0; i < len; i++)
        {
            frame.data.bytes[i] = uint8_t(buf[i]);
        }
        frame.id = CAN.getCanId();
        frame.extended = (bool)CAN.isExtendedFrame();
        frame.rtr = CAN.isRemoteRequest();

        if(frame.id == 0) {
            return;
        }


        if( frame.id == OCS_CAN_ID_1) {
        Logger::info("RECEIVED CAN:%d dlc=%X fid=%X id=%X ide=%X rtr=%X data=%X,%X,%X,%X,%X,%X,%X,%X", 0,
                      frame.length, frame.fid, frame.id, frame.extended, frame.rtr,
                      frame.data.bytes[0], frame.data.bytes[1], frame.data.bytes[2], frame.data.bytes[3],
                      frame.data.bytes[4], frame.data.bytes[5], frame.data.bytes[6], frame.data.bytes[7]);
        }

        if (frame.id == OCS_CAN_ID_2) {
        Logger::info("RECEIVED CAN:%d dlc=%X fid=%X id=%X ide=%X rtr=%X data=%X,%X,%X,%X,%X,%X,%X,%X", 0,
                      frame.length, frame.fid, frame.id, frame.extended, frame.rtr,
                      frame.data.bytes[0], frame.data.bytes[1], frame.data.bytes[2], frame.data.bytes[3],
                      frame.data.bytes[4], frame.data.bytes[5], frame.data.bytes[6], frame.data.bytes[7]);
        }
    }

    // Periodic transmission: Send state every 1000ms if initialized
    if (initialized && (millis() - lastTransmitTime >= CAN_TRANSMIT_INTERVAL)) {
        sendPeriodicState();
        lastTransmitTime = millis();
    }
}



//(whatever happens to be open) or queue it to send (if nothing is open)
void CanHandler::sendFrame(CAN_FRAME &frame)
{

    // Logger::debug("CANIO %d msg: %X   %X   %X   %X   %X   %X   %X   %X  %X", 0, frame.id, frame.data.bytes[0],
    //              frame.data.bytes[1], frame.data.bytes[2], frame.data.bytes[3], frame.data.bytes[4],
    //              frame.data.bytes[5], frame.data.bytes[6], frame.data.bytes[7]);

    CAN.MCP_CAN::sendMsgBuf(frame.id, frame.extended, 8, frame.data.bytes);
}

// PassengerStateInput interface implementation
void CanHandler::processInput(PassengerState& state) {
    // TODO: Implement CAN reading logic to update passenger state
    // This would read occupant sensor data from CAN bus and update the state
    // For now, this is a placeholder for future implementation
}

bool CanHandler::isInputReady() {
    return initialized;
}

// PassengerStateOutput interface implementation
void CanHandler::applyState(const PassengerState& state) {
    // Store the current state for periodic transmission
    currentState = state;

    // Send immediately on state change, then process() will handle periodic sends
    sendPeriodicState();
    lastTransmitTime = millis();

    Logger::debug("CAN: State updated - Buckled: %d, Type: %d",
                  state.isBuckled(), state.getPassengerType());
}

bool CanHandler::isOutputReady() {
    return initialized;
}

// Send passenger state via CAN
void CanHandler::sendPeriodicState() {
    if (!initialized) {
        return;
    }

    // Create CAN frame with passenger state
    CAN_FRAME frame;
    frame.id = OCS_CAN_ID_1;  // Using first OCS CAN ID for output
    frame.extended = false;
    frame.rtr = false;
    frame.length = 8;

    // Encode passenger state in CAN message
    // Byte 0: Seatbelt status (0 = unbuckled, 1 = buckled)
    frame.data.bytes[0] = currentState.isBuckled() ? 1 : 0;

    // Byte 1: Passenger type (0 = none, 1 = child, 2 = adult)
    frame.data.bytes[1] = (uint8_t)currentState.getPassengerType();

    // Bytes 2-7: Reserved/padding
    for (int i = 2; i < 8; i++) {
        frame.data.bytes[i] = 0;
    }

    sendFrame(frame);

    Logger::debug("CAN: Sent state - ID: 0x%X, Buckled: %d, Type: %d",
                  frame.id, frame.data.bytes[0], frame.data.bytes[1]);
}
