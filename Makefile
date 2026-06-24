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

# Mobile app (mobile/) — React Native needs JDK 17 and node on PATH for Gradle.
JAVA_HOME_17 := /Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home
NODE_DIR     := $(shell dirname $(shell which node))
RELEASE_APK  := mobile/android/app/build/outputs/apk/release/app-release.apk

.DEFAULT_GOAL := help

.PHONY: help build upload web fs flash monitor clean \
	mobile-install mobile-start mobile-metro mobile-android mobile-android-fresh \
	mobile-android-release mobile-android-release-install mobile-android-bundle \
	mobile-ios reset-android-cache \
	release-mobile-patch release-mobile-minor release-mobile-major

help: ## Show this help
	@echo "Targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'

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

# ----------------------------------------------------------------------------
# Mobile app (mobile/) — see mobile/README.md. Android needs JDK 17 + a device.
# ----------------------------------------------------------------------------

mobile-install: ## Mobile: install JS dependencies (npm install)
	cd mobile && npm install

mobile-start: ## Mobile: start Metro bundler in foreground (separate terminal)
	cd mobile && npx react-native start --reset-cache

mobile-metro: ## Mobile: start Metro bundler in background
	cd mobile && npx react-native start --reset-cache &

mobile-android: ## Mobile: build + run debug on a connected Android device (needs Metro)
	adb reverse tcp:8081 tcp:8081
	cd mobile && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" npx react-native run-android

mobile-android-fresh: ## Mobile: adb reverse + Metro in background + debug build (one command)
	adb reverse tcp:8081 tcp:8081
	cd mobile && npx react-native start &
	sleep 8
	adb reverse tcp:8081 tcp:8081
	cd mobile && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" npx react-native run-android

mobile-android-release: ## Mobile: build a self-contained release APK for sideloading
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew assembleRelease
	@echo ""
	@if [ ! -f "$(RELEASE_APK)" ]; then echo "❌ No APK found at $(RELEASE_APK)"; exit 1; fi; \
	echo "✅ Release APK: $(RELEASE_APK)"

mobile-android-release-install: mobile-android-release ## Mobile: build release APK + install on connected device
	adb install -r "$(RELEASE_APK)"

mobile-android-bundle: ## Mobile: build a release AAB for the Play Store
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew bundleRelease
	@echo ""
	@echo "✅ Release AAB: mobile/android/app/build/outputs/bundle/release/app-release.aab"

mobile-ios: ## Mobile: build + run on iOS (best-effort)
	cd mobile && npx react-native run-ios

reset-android-cache: ## Mobile: clean the Android Gradle build cache
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) ./gradlew clean

# ----------------------------------------------------------------------------
# Mobile app release: bump version, tag `mobile-v*`, and push. The push triggers
# .github/workflows/mobile-release.yml, which builds the signed APK + SHA256 and
# publishes a GitHub Release that the in-app updater consumes.
# ----------------------------------------------------------------------------

release-mobile-patch: ## Mobile: bump patch, tag mobile-v*, push (auto-detects next version)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.0.1"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		patch=$$(echo $$ver | awk -F. '{print $$3}'); \
		next="$$major.$$minor.$$((patch + 1))"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-mobile-minor: ## Mobile: bump minor, tag mobile-v*, push (auto-detects next version)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.1.0"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		next="$$major.$$((minor + 1)).0"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-mobile-major: ## Mobile: bump major, tag mobile-v*, push (auto-detects next version)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="1.0.0"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		next="$$((major + 1)).0.0"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"
