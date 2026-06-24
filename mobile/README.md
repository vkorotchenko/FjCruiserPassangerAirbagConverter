# FJ OCS Setup — Mobile App

A small React Native companion app for the **FJ Cruiser Passenger Airbag /
Occupant Classification System (OCS) converter** firmware.

It does two jobs:

1. **Get the converter onto your WiFi.** On launch it looks for the converter —
   first directly on your home network (by last-known IP or `fj-ocs.local`),
   then via the converter's own access point. If it's already configured, its
   **web control panel** opens straight away. If not, you enter your home WiFi
   name + password and the converter joins your network.
2. **Keep the converter firmware up to date.** Settings shows the converter's
   firmware version and offers an over-the-air (OTA) firmware update from this
   repo's GitHub Releases.

The app talks to the firmware's `GET /api/info`, `POST /api/wifi`, and
`POST /api/ota` endpoints, and embeds the web UI the firmware serves.

## How it works

```
Phone (this app)
   │  on launch: probe 192.168.4.1 (AP), last home IP, fj-ocs.local
   ▼
   ├── reachable + staOk ──────────────► WebView → control panel  (direct)
   │
   └── not reachable → join AP "FJ-OCS-Config" (WPA2 "fjcruiser")
          │  POST /api/wifi {ssid, pass} → firmware WiFi.begin()
          │  poll GET /api/info until staOk → confirms it joined your network
          ▼
        WebView → converter control panel
```

The ESP32 runs its access point **and** a station connection at the same time
(`WIFI_AP_STA`), so the AP is an always-available fallback for (re)configuring
and reading the firmware version, while `fj-ocs.local` / its DHCP IP reach it on
the home network. Firmware OTA images are uploaded to `POST /api/ota`.

These values mirror the firmware's `src/config.h` (`WIFI_AP_SSID` /
`WIFI_AP_PASS` / `WIFI_HOSTNAME`) and live in
[`src/constants.ts`](src/constants.ts). If you change them in the firmware,
change them here too.

## Tech stack

| Component | Version |
|-----------|---------|
| React Native | 0.84.1 |
| React | 19.2.x |
| TypeScript | 5.x |
| React Navigation | 7.x (stack) |
| react-native-paper | 5.x (UI) |
| zustand | 5.x (state) |
| react-native-webview | 14.x (embedded control panel) |
| react-native-wifi-reborn | 4.x (read SSID + join AP) |
| react-native-blob-util + js-sha256 | firmware .bin download + verify |

## Project structure

```
mobile/
├── App.tsx                      # Providers + navigation root
├── index.js                     # Entry (registers gesture-handler)
├── src/
│   ├── constants.ts             # AP SSID/pass + AP/mDNS URLs
│   ├── navigation/
│   │   └── AppNavigator.tsx      # Stack: Setup -> WebUi -> Settings
│   ├── screens/
│   │   ├── WifiSetupScreen.tsx   # Auto-connect / WiFi setup form
│   │   ├── WebUiScreen.tsx       # Embedded firmware web UI (WebView)
│   │   └── SettingsScreen.tsx    # Saved WiFi, firmware OTA, app version
│   ├── components/
│   │   └── FirmwareUpdateSection.tsx  # Firmware OTA UI
│   ├── services/
│   │   ├── permissions.ts        # Android runtime WiFi/location permissions
│   │   ├── wifiManager.ts        # Read SSID, join AP, bind app to WiFi
│   │   ├── firmwareApi.ts        # /api/info, /api/wifi, probe, active base URL
│   │   ├── githubReleases.ts     # latest firmware-v* release lookup
│   │   ├── firmwareDownload.ts   # download + SHA256-verify the .bin
│   │   ├── firmwareOta.ts        # upload .bin to /api/ota, await reboot
│   │   └── firmwareUpdateController.ts  # OTA orchestration
│   └── store/
│       └── useAppStore.ts        # zustand store (WiFi creds, firmware OTA)
├── android/                      # Native Android project
└── ios/                          # Native iOS project (best-effort)
```

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **Android:** Android Studio / SDK, **JDK 17**, a device or emulator
- **iOS (best-effort):** Xcode, CocoaPods

## Install & run

```bash
cd mobile
npm install

# Android (Metro starts automatically)
npm run android

# iOS (best-effort — see notes below)
cd ios && pod install && cd ..
npm run ios
```

### Build a release APK (sideloading)

```bash
cd mobile
npm run android:release
# output: android/app/build/outputs/apk/release/app-release.apk
```

> The release build is signed with the bundled debug keystore for convenience.
> Generate and configure your own keystore before distributing.

## Checks

```bash
npm run tsc    # TypeScript type-check (no emit)
npm run lint   # ESLint
npm test       # Jest
```

## Settings

A **Settings** screen (gear icon, top-right of both screens) holds:

- **Saved home WiFi** — the SSID *and* password you entered are saved to the
  app's private preferences (AsyncStorage) and pre-filled next time, so you
  don't retype them. A **Clear saved WiFi** button forgets both (it does not
  change what the converter already stored). Note: AsyncStorage is not encrypted
  at rest — acceptable for this single-purpose tool.
- **Firmware update** — the converter's firmware OTA (see below).
- **App** — the app's own version (informational; update the app by installing a
  newer APK from GitHub Releases).

## Firmware updates (OTA)

The app updates the **converter firmware** over WiFi:

- It reads the converter's current version from `GET /api/info` (`fwVersion`) and
  checks this repo's **GitHub Releases** (1-hour cached) for a newer
  `firmware-v*` release.
- When a newer version exists, **Check → Flash** downloads the `.bin`, verifies
  its **SHA256**, then uploads it to the converter's `POST /api/ota`. The
  converter writes it to its inactive OTA partition and reboots into the new
  firmware (rollback-safe — a bad/interrupted image leaves the old one running).
- Flashing needs **both** internet (to download the `.bin`) and a reachable
  converter (to upload). This works best when the converter is already on your
  home network and the phone has internet on the same network.

> ⚠️ Don't power off the converter or close the app while it's flashing.

Key files: `src/services/githubReleases.ts` (release lookup),
`src/services/firmwareDownload.ts` (download + SHA256 verify),
`src/services/firmwareOta.ts` (upload to `/api/ota` + await reboot),
`src/services/firmwareUpdateController.ts` (orchestration),
`src/components/FirmwareUpdateSection.tsx` (UI). Firmware endpoint:
`src/WebInterface.cpp` (`POST /api/ota`).

### Cutting a firmware release

From the repo root, bump + tag + push (CI builds and publishes):

```bash
make release-firmware-patch   # or -minor / -major
```

Pushing a `firmware-v*` tag triggers `.github/workflows/firmware-release.yml`,
which stamps the version into `config.h`, builds the firmware, and publishes a
GitHub Release with `fj-ocs-firmware-<version>.bin` + `.bin.sha256` — exactly
what the in-app updater downloads.

### Distributing the app itself

The app is distributed as a sideloaded APK (it does **not** self-update):

```bash
make release-mobile-patch   # tags mobile-v* -> builds + publishes the APK
```

## Platform notes

This app is **Android-first**. Reading the current WiFi SSID and joining the
converter's AP work out of the box on Android with the location / nearby-WiFi
permissions the app requests at launch.

- **Auto-connect:** on launch the app probes for the converter (home network or
  AP) and connects automatically; if it must join the AP and that fails, it
  shows an inline error with a Retry button.
- **Cleartext HTTP:** the converter serves plain `http://`/`ws://` and accepts
  OTA over HTTP, on an arbitrary home-network IP. Android permits cleartext
  generally via `android/app/src/main/res/xml/network_security_config.xml` (only
  local-converter traffic is cleartext; GitHub downloads are HTTPS); iOS allows
  it via `NSAllowsLocalNetworking`.
- **iOS (best-effort):** the project builds, but automatic SSID pre-fill and
  programmatic AP join require Apple's *Access WiFi Information* and *Hotspot
  Configuration* entitlements (a paid Apple Developer account + provisioning
  changes). Without them the app degrades gracefully: enter the SSID by hand and
  join `FJ-OCS-Config` from iOS WiFi settings before retrying.

## Troubleshooting

- **"Couldn't reach the converter"** — make sure the converter is powered and
  you're joined to `FJ-OCS-Config` (password `fjcruiser`). Phones may drop an
  internet-less WiFi; the app forces traffic over it on Android, but if you
  joined manually, stay on that network.
- **Converter never finishes joining your WiFi** — almost always a wrong home
  WiFi password. The app times out and returns you to the setup screen to retry.
- **Page won't load in the control panel** — tap refresh; if it persists, go
  back to setup and reconnect.
