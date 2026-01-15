#ifndef PASSENGER_STATE_H_
#define PASSENGER_STATE_H_

#include <Arduino.h>

enum PassengerType {
    NO_PASSENGER = 0,
    CHILD = 1,
    ADULT = 2
};

class PassengerState {
public:
    PassengerState();

    // Getters
    bool isBuckled() const;
    bool hasPassenger() const;
    PassengerType getPassengerType() const;

    // Setters
    void setBuckled(bool buckled);
    void setPassengerType(PassengerType type);

    // Utility methods
    void reset();
    bool hasChanged() const;
    void clearChanged();

private:
    bool buckled;
    PassengerType passengerType;
    bool changed;

    // Previous state for change detection
    bool prevBuckled;
    PassengerType prevPassengerType;

    void updateChangeFlag();
};

extern PassengerState passengerState;

#endif /* PASSENGER_STATE_H_ */
