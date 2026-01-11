#include <Arduino.h>
#include "CanHandler.h"
#include "k_line.h"
#include "config.h"

// put function declarations here:
int myFunction(int, int);

void setup() {
	// Initialize USB Serial for logging/debugging
	Serial.begin(SERIAL_SPEED);
	while (!Serial) { delay(10); } // Wait for serial port to connect

	// put your setup code here, to run once:
	int result = myFunction(2, 3);
  SERIAL_PORT_MONITOR.begin(SERIAL_SPEED);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(SPI_CS_PIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
	canHandler.setup();
	kLineHandler.setup();

	// Initialize K-line protocol
	if (!kLineHandler.initProtocol()) {
		Logger::info("K-line initialization failed");
	}
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
	canHandler.process();
	kLineHandler.process();
    canHandler.process();
}