#include <Arduino.h>
#include "CanHandler.h"

void setup() {
  SERIAL_PORT_MONITOR.begin(SERIAL_SPEED);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(SPI_CS_PIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
	canHandler.setup();
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
    canHandler.process();
}