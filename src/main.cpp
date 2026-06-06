#include <Arduino.h>
#include "config.h"
#include "RuntimeConfig.h"
#include "Logger.h"
#include "Handler.h"
#include "PassengerState.h"
#include "InputOutputManager.h"
#include "EspLink.h"
#include "WebInterface.h"

// All handlers are compiled in unconditionally now; which ones actually run is
// decided at runtime from g_config (see RuntimeConfig.h). Pin assignments stay
// compile-time in config.h.
#include "CanHandler.h"
#include "KLineInput.h"
#include "KLineOutput.h"
#include "ButtonHandler.h"
#include "digital_pot.h"
#include "SeatbeltRelay.h"

// Array of handlers for polymorphic processing (CAN, K-line In, K-line Out, Button)
Handler* handlers[4];
uint8_t handlerCount = 0;

void setup() {
	SERIAL_PORT_MONITOR.begin(SERIAL_SPEED);
	// On the ESP32-S2 Serial is USB CDC (ARDUINO_USB_CDC_ON_BOOT=1). With no host
	// attached `!Serial` never clears, so block only briefly for a monitor to
	// connect, then boot regardless - this device normally runs headless in a car.
	unsigned long serialWaitStart = millis();
	while (!SERIAL_PORT_MONITOR && millis() - serialWaitStart < 1500) {
		delay(10);
	}

	Logger::info("=== Passenger Airbag Converter Starting ===");

	// Load runtime configuration from flash (falls back to config.h defaults).
	ConfigStore::load(g_config);

	// Bring up the control engine and route logs to it as well as USB, then
	// start WiFi + the web server (which registers the WebSocket as EspLink's
	// event sender).
	espLink.setup();
	Logger::setSink(&espLink);
	webInterface.setup();

	// Setup LED and SPI pins
	pinMode(LED_BUILTIN, OUTPUT);
	pinMode(SPI_CS_PIN, OUTPUT);
	digitalWrite(LED_BUILTIN, HIGH);

	ioManager.begin();

	// Register all process()-driven handlers. Each handler's process() is gated
	// by isActive() in the loop, so disabled handlers register but stay idle.
	handlers[handlerCount++] = &canHandler;
	handlers[handlerCount++] = &kLineInput;
	handlers[handlerCount++] = &kLineOutput;
	handlers[handlerCount++] = &buttonHandler;

	// Heavy / hardware-touching setup is gated on the enable flags so an absent
	// bus can't hang boot. Enabling a bus that was off at boot needs a reboot.
	if (g_config.useCanInput || g_config.useCanOutput) {
		canHandler.setup();
	}

	if (g_config.useKlineInput) {
		kLineInput.setup();
		if (!kLineInput.initProtocol()) {
			Logger::info("K-line input initialization failed");
		}
	}

	if (g_config.useKlineOutput) {
		kLineOutput.setup();
	}

	// Pin-only setups, gated so a disabled peripheral never claims its GPIOs
	// (e.g. the parked DPOT pins overlap others). Enabling one later needs a reboot.
	if (g_config.useButtonInput) buttonHandler.setup();
	if (g_config.useDpotOutput)  digitalPotHandler.setup();
	if (g_config.useRelayOutput) seatbeltRelay.setup();

	Logger::info("Registered %d handler(s) for polymorphic processing", handlerCount);

	// Log input/output configuration (runtime, from g_config)
	Logger::info("Input sources: %s%s%s",
		g_config.useKlineInput ? "K-line " : "",
		g_config.useCanInput ? "CAN " : "",
		g_config.useButtonInput ? "Button " : "");
	Logger::info("Output targets: %s%s%s%s",
		g_config.useKlineOutput ? "K-line " : "",
		g_config.useCanOutput ? "CAN " : "",
		g_config.useDpotOutput ? "DigitalPot " : "",
		g_config.useRelayOutput ? "Relay " : "");

	digitalWrite(LED_BUILTIN, LOW);
	Logger::info("=== Setup Complete ===");
}

void loop() {
	// Service the web server and the control engine (flush log/frame rings).
	webInterface.loop();
	espLink.poll();

	// Process all enabled handlers using polymorphism
	for (uint8_t i = 0; i < handlerCount; i++) {
		if (handlers[i] != nullptr && handlers[i]->isActive()) {
			handlers[i]->process();
		}
	}

	// Process inputs to update passenger state
	ioManager.processInputs(passengerState);

	// Manual override (bench testing) wins over whatever the inputs produced.
	if (g_config.overrideEnabled) {
		passengerState.setBuckled(g_config.overrideBuckled);
		passengerState.setPassengerType((PassengerType)g_config.overridePassengerType);
	}

	// Push state to all outputs every loop (handlers decide their own cadence).
	ioManager.applyOutputs(passengerState);

	// Log + notify the web UI only when the state actually changed.
	if (passengerState.hasChanged()) {
		Logger::info("Passenger state changed - Buckled: %d, Type: %d",
			passengerState.isBuckled(),
			passengerState.getPassengerType());
		espLink.publishState(passengerState, g_config.overrideEnabled);
	}
	passengerState.clearChanged();
}
