#include "PassengerState.h"

PassengerState passengerState;

PassengerState::PassengerState() {
    reset();
}

void PassengerState::reset() {
    buckled = false;
    passengerType = NO_PASSENGER;
    prevBuckled = false;
    prevPassengerType = NO_PASSENGER;
    changed = false;
}

bool PassengerState::isBuckled() const {
    return buckled;
}

bool PassengerState::hasPassenger() const {
    return passengerType != NO_PASSENGER;
}

PassengerType PassengerState::getPassengerType() const {
    return passengerType;
}

void PassengerState::setBuckled(bool buckled) {
    this->buckled = buckled;
    updateChangeFlag();
}

void PassengerState::setPassengerType(PassengerType type) {
    this->passengerType = type;
    updateChangeFlag();
}

bool PassengerState::hasChanged() const {
    return changed;
}

void PassengerState::clearChanged() {
    changed = false;
    prevBuckled = buckled;
    prevPassengerType = passengerType;
}

void PassengerState::updateChangeFlag() {
    if (buckled != prevBuckled || passengerType != prevPassengerType) {
        changed = true;
    }
}
