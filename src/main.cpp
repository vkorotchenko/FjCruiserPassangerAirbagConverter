#include <Arduino.h>
#include "CanHandler.h"
#include "k_line.h"
#include "config.h"

void setup() {
	// Initialize USB Serial for logging/debugging
	Serial.begin(SERIAL_SPEED);
	while (!Serial) {
		delay(10);
	}

	SERIAL_PORT_MONITOR.begin(SERIAL_SPEED);

	// Setup LED and SPI pins
	pinMode(LED_BUILTIN, OUTPUT);
	pinMode(SPI_CS_PIN, OUTPUT);
	digitalWrite(LED_BUILTIN, HIGH);

	// Initialize handlers
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
}