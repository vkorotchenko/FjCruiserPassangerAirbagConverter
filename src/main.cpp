#include <Arduino.h>
#include "config.h"
#include "Logger.h"
#include "Handler.h"
#include "PassengerState.h"
#include "InputOutputManager.h"

// Include individual handlers based on config
#if USE_CAN_INPUT || USE_CAN_OUTPUT
#include "CanHandler.h"
#endif

#if USE_KLINE_INPUT || USE_KLINE_OUTPUT
#include "k_line.h"
#endif

#if USE_BUTTON_INPUT
#include "ButtonHandler.h"
#endif

#if USE_DPOT_OUTPUT
#include "digital_pot.h"
#endif

#if USE_RELAY_OUTPUT
#include "SeatbeltRelay.h"
#endif

// Array of handlers for polymorphic processing
Handler* handlers[3];  // Max 3 handlers (CAN, K-line, Button)
uint8_t handlerCount = 0;

void setup() {
	SERIAL_PORT_MONITOR.begin(SERIAL_SPEED);
	while (!SERIAL_PORT_MONITOR) {
		delay(10);
	}
SERIAL_PORT_MONITOR.println("TEST");
	Logger::info("=== Passenger Airbag Converter Starting ===");

	// Setup LED and SPI pins
	pinMode(LED_BUILTIN, OUTPUT);
	pinMode(SPI_CS_PIN, OUTPUT);
	digitalWrite(LED_BUILTIN, HIGH);

	ioManager.begin();

	// Initialize handlers based on configuration and add to handlers array
#if USE_CAN_INPUT || USE_CAN_OUTPUT
	handlers[handlerCount++] = &canHandler;
	canHandler.setup();
#endif

#if USE_KLINE_INPUT || USE_KLINE_OUTPUT
	handlers[handlerCount++] = &kLineHandler;
	kLineHandler.setup();

	// Initialize K-line protocol
	if (!kLineHandler.initProtocol()) {
		Logger::info("K-line initialization failed");
	}
#endif

#if USE_BUTTON_INPUT
	handlers[handlerCount++] = &buttonHandler;
	buttonHandler.setup();
#endif

#if USE_DPOT_OUTPUT
	digitalPotHandler.setup();
#endif

#if USE_RELAY_OUTPUT
	seatbeltRelay.setup();
#endif

	Logger::info("Registered %d handler(s) for polymorphic processing", handlerCount);

	// Log input/output configuration
	Logger::info("Input sources: %s%s%s",
		USE_KLINE_INPUT ? "K-line " : "",
		USE_CAN_INPUT ? "CAN " : "",
		USE_BUTTON_INPUT ? "Button " : "");
	Logger::info("Output targets: %s%s%s%s",
		USE_KLINE_OUTPUT ? "K-line " : "",
		USE_CAN_OUTPUT ? "CAN " : "",
		USE_DPOT_OUTPUT ? "DigitalPot " : "",
		USE_RELAY_OUTPUT ? "Relay " : "");

	digitalWrite(LED_BUILTIN, LOW);
	Logger::info("=== Setup Complete ===");
}

void loop() {
	// Process all handlers using polymorphism
	for (uint8_t i = 0; i < handlerCount; i++) {
		if (handlers[i] != nullptr) {
			handlers[i]->process();
		}
	}

	// Process inputs to update passenger state
	ioManager.processInputs(passengerState);

	// If state has changed, apply to all outputs
	if (passengerState.hasChanged()) {
		Logger::info("Passenger state changed - Buckled: %d, Type: %d",
			passengerState.isBuckled(),
			passengerState.getPassengerType());

		ioManager.applyOutputs(passengerState);
		passengerState.clearChanged();
	}
}