# FJ Cruiser passenger-airbag converter - build/flash helpers.
#
# The firmware AND the web UI both have to be on the board: the firmware hosts
# the web server in-process, and the web assets live in a separate LittleFS
# image. `make flash` does the whole thing in one call.
#
# Quick start (board plugged in over USB):
#   make flash      # build web -> upload firmware -> upload web filesystem
#   make monitor    # watch the serial/USB-CDC log

PIO ?= pio
ENV ?= adafruit_feather_esp32s2
PIOENV := $(PIO) run -e $(ENV)

.DEFAULT_GOAL := help

.PHONY: help build upload web fs flash monitor clean

help: ## Show this help
	@echo "Targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: ## Compile the firmware
	$(PIOENV)

upload: ## Compile + flash the firmware
	$(PIOENV) -t upload

web: ## Gzip web/ into the data_esp/ LittleFS source
	scripts/build_web.sh

fs: web ## Build web assets + flash the LittleFS image
	$(PIOENV) -t uploadfs

flash: upload fs ## One-shot: firmware + web UI onto the board
	@echo "Done. Connect to WiFi 'FJ-OCS-Config' (pass: fjcruiser) and open http://192.168.4.1"

monitor: ## Open the serial/USB-CDC monitor
	$(PIO) device monitor -e $(ENV)

clean: ## Remove build artifacts
	$(PIOENV) -t clean
