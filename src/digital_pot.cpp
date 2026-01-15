#include "digital_pot.h"
#include "config.h"

// Global singleton instance
DigitalPotHandler digitalPotHandler = DigitalPotHandler();

// Constructor
DigitalPotHandler::DigitalPotHandler()
    : pot1(DPOT_MAX_OHM)  // Front Left
    , pot2(DPOT_MAX_OHM)  // Front Right
    , pot3(DPOT_MAX_OHM)  // Rear Left
    , pot4(DPOT_MAX_OHM)  // Rear Right
    , currentState(OCCUPANT_OFF)
{
}

// Setup - Initialize all 4 digital potentiometers
void DigitalPotHandler::setup() {
    Logger::info("Digital Pot: Initializing 4x X9C10X (10kOhm each)...");

    // Initialize potentiometer 1 (Front Left)
    pot1.begin(DPOT1_INC_PIN, DPOT1_UD_PIN, DPOT1_CS_PIN);
    Logger::debug("Digital Pot 1 (FL): INC=%d, UD=%d, CS=%d", DPOT1_INC_PIN, DPOT1_UD_PIN, DPOT1_CS_PIN);

    // Initialize potentiometer 2 (Front Right)
    pot2.begin(DPOT2_INC_PIN, DPOT2_UD_PIN, DPOT2_CS_PIN);
    Logger::debug("Digital Pot 2 (FR): INC=%d, UD=%d, CS=%d", DPOT2_INC_PIN, DPOT2_UD_PIN, DPOT2_CS_PIN);

    // Initialize potentiometer 3 (Rear Left)
    pot3.begin(DPOT3_INC_PIN, DPOT3_UD_PIN, DPOT3_CS_PIN);
    Logger::debug("Digital Pot 3 (RL): INC=%d, UD=%d, CS=%d", DPOT3_INC_PIN, DPOT3_UD_PIN, DPOT3_CS_PIN);

    // Initialize potentiometer 4 (Rear Right)
    pot4.begin(DPOT4_INC_PIN, DPOT4_UD_PIN, DPOT4_CS_PIN);
    Logger::debug("Digital Pot 4 (RR): INC=%d, UD=%d, CS=%d", DPOT4_INC_PIN, DPOT4_UD_PIN, DPOT4_CS_PIN);

    // Set all to OFF state initially
    setOccupantState(OCCUPANT_OFF);

    Logger::info("Digital Pot: All 4 potentiometers initialized");
}

// Set occupant state (off, child, or adult)
void DigitalPotHandler::setOccupantState(OccupantState state) {
    Logger::info("Digital Pot: Setting occupant state to %d", state);

    currentState = state;

    switch (state) {
        case OCCUPANT_OFF:
            setPosition(DPOT_POSITION_OFF);
            Logger::debug("Digital Pot: Set to OFF (position %d)", DPOT_POSITION_OFF);
            break;

        case OCCUPANT_CHILD:
            setPosition(DPOT_POSITION_CHILD);
            Logger::debug("Digital Pot: Set to CHILD (position %d)", DPOT_POSITION_CHILD);
            break;

        case OCCUPANT_ADULT:
            setPosition(DPOT_POSITION_ADULT);
            Logger::debug("Digital Pot: Set to ADULT (position %d)", DPOT_POSITION_ADULT);
            break;

        default:
            Logger::info("Digital Pot: Unknown state %d, setting to OFF", state);
            setPosition(DPOT_POSITION_OFF);
            currentState = OCCUPANT_OFF;
            break;
    }
}

// Set specific wiper position on all 4 potentiometers (0-99)
void DigitalPotHandler::setPosition(uint8_t position) {
    // Ensure position is within valid range
    if (position > 99) {
        position = 99;
    }

    Logger::debug("Digital Pot: Moving all 4 pots to position %d", position);

    // Set all potentiometers to the same position
    pot1.setPosition(position);
    pot1.store();

    pot2.setPosition(position);
    pot2.store();

    pot3.setPosition(position);
    pot3.store();

    pot4.setPosition(position);
    pot4.store();

    Logger::debug("Digital Pot: All 4 pots set to position %d", position);
}

// Set individual potentiometer position (0-3 for pot index, 0-99 for position)
void DigitalPotHandler::setPositionIndividual(uint8_t potIndex, uint8_t position) {
    // Ensure position is within valid range
    if (position > 99) {
        position = 99;
    }

    Logger::debug("Digital Pot: Setting pot %d to position %d", potIndex, position);

    // Set the selected potentiometer
    switch (potIndex) {
        case 0:  // Front Left
            pot1.setPosition(position);
            pot1.store();
            break;
        case 1:  // Front Right
            pot2.setPosition(position);
            pot2.store();
            break;
        case 2:  // Rear Left
            pot3.setPosition(position);
            pot3.store();
            break;
        case 3:  // Rear Right
            pot4.setPosition(position);
            pot4.store();
            break;
        default:
            Logger::info("Digital Pot: Invalid pot index %d (valid range: 0-3)", potIndex);
            return;
    }

    Logger::debug("Digital Pot: Pot %d set to position %d", potIndex, position);
}

// Get current occupant state
OccupantState DigitalPotHandler::getCurrentState() {
    return currentState;
}

// PassengerStateOutput interface implementation
void DigitalPotHandler::applyState(const PassengerState& state) {
    // Map PassengerState to OccupantState and apply
    if (!state.hasPassenger()) {
        setOccupantState(OCCUPANT_OFF);
    } else if (state.getPassengerType() == CHILD) {
        setOccupantState(OCCUPANT_CHILD);
    } else if (state.getPassengerType() == ADULT) {
        setOccupantState(OCCUPANT_ADULT);
    }
}

bool DigitalPotHandler::isOutputReady() {
    // Digital pot is always ready once setup() is called
    return true;
}
