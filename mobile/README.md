# FJ OCS Setup — Mobile App

A small React Native companion app for the **FJ Cruiser Passenger Airbag /
Occupant Classification System (OCS) converter** firmware.

It does one job, simply:

1. You enter your **home WiFi name and password** (the network name is
   pre-filled from your phone's current connection where possible).
2. The app joins the converter's own WiFi access point and hands it those
   credentials so the converter joins your home network.
3. The app then opens the converter's existing **web control panel** in an
   embedded view.

The converter firmware is unchanged — this app talks to its existing
`POST /api/wifi` and `GET /api/info` endpoints and then embeds the web UI it
already serves at `http://192.168.4.1`.

## How it works

```
Phone (this app)
   │  1. read current SSID (prefill)
   │  2. join AP  "FJ-OCS-Config"  (WPA2, pass "fjcruiser")
   ▼
ESP32 SoftAP  192.168.4.1
   │  3. POST /api/wifi {ssid, pass}   → firmware calls WiFi.begin()
   │  4. poll GET /api/info until staOk → firmware joined home WiFi
   ▼
WebView → http://192.168.4.1/   (the converter's control panel)
```

The ESP32 runs its access point **and** a station connection at the same time
(`WIFI_AP_STA`), so `192.168.4.1` stays reachable over its own AP even after it
joins your home network — the app never has to switch networks to show the UI.

These values mirror the firmware's `src/config.h`
(`WIFI_AP_SSID` / `WIFI_AP_PASS`) and live in [`src/constants.ts`](src/constants.ts).
If you change them in the firmware, change them here too.

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

## Project structure

```
mobile/
├── App.tsx                      # Providers + navigation root
├── index.js                     # Entry (registers gesture-handler)
├── src/
│   ├── constants.ts             # AP SSID/pass + firmware base URL
│   ├── navigation/
│   │   └── AppNavigator.tsx      # Stack: Setup -> WebUi
│   ├── screens/
│   │   ├── WifiSetupScreen.tsx   # Landing: SSID/password + connect flow
│   │   └── WebUiScreen.tsx       # Embedded firmware web UI (WebView)
│   ├── services/
│   │   ├── permissions.ts        # Android runtime WiFi/location permissions
│   │   ├── wifiManager.ts        # Read SSID, join AP, bind app to WiFi
│   │   └── firmwareApi.ts        # GET /api/info, POST /api/wifi, poll staOk
│   └── store/
│       └── useAppStore.ts        # zustand store (remembers last SSID)
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

## In-app updates (OTA)

The app can update itself, mirroring the `pao_console_dial` updater:

- On launch it checks this repo's **GitHub Releases** (1-hour cached) for a newer
  `mobile-v*` release.
- The setup screen footer shows the running version and an **Update / Check**
  button. When a newer release exists, it downloads the APK to cache, verifies
  its **SHA256**, then hands it to the Android package installer.
- **Android only** — iOS can't sideload APKs, so on iOS the updater just opens
  the GitHub release page. The first install prompts for the "install unknown
  apps" permission.

Key files: `src/services/githubReleases.ts` (release lookup),
`src/services/mobileAppDownload.ts` (streamed download + verify),
`src/services/apkInstaller.ts` + `android/.../ApkInstallerModule.kt` (install),
`src/services/mobileUpdateController.ts` (orchestration),
`src/components/AppUpdateSection.tsx` (UI).

### Cutting a release

From the repo root, bump + tag + push (CI does the rest):

```bash
make release-mobile-patch   # or -minor / -major
```

Pushing a `mobile-v*` tag triggers `.github/workflows/mobile-release.yml`, which
builds a signed APK, writes a SHA256 sidecar, and publishes a GitHub Release with
`fj-ocs-setup-<version>.apk` + `.apk.sha256`. The APK is signed with the committed
debug keystore so every build shares one signature (required for sideloaded OTA
updates to install over the top) — it is **not** Play Store eligible.

## Platform notes

This app is **Android-first**. Reading the current WiFi SSID and joining the
converter's AP work out of the box on Android with the location / nearby-WiFi
permissions the app requests at launch.

- **Auto-join with manual fallback:** the app tries to join `FJ-OCS-Config`
  programmatically. If that fails (some OEMs restrict it), it shows a short
  guided dialog to join from system WiFi settings, then continues automatically.
- **Cleartext HTTP:** the firmware serves plain `http://` + `ws://` on its AP.
  Android allows this only for `192.168.4.1` / `fj-ocs` via
  `android/app/src/main/res/xml/network_security_config.xml`; iOS allows it via
  `NSAllowsLocalNetworking`.
- **iOS (best-effort):** the project builds, but automatic SSID pre-fill and
  programmatic AP join require Apple's *Access WiFi Information* and *Hotspot
  Configuration* entitlements (a paid Apple Developer account + provisioning
  changes). Without them the app degrades gracefully: enter the SSID by hand and
  use the guided manual-join flow.

## Troubleshooting

- **"Couldn't reach the converter"** — make sure the converter is powered and
  you're joined to `FJ-OCS-Config` (password `fjcruiser`). Phones may drop an
  internet-less WiFi; the app forces traffic over it on Android, but if you
  joined manually, stay on that network.
- **Converter never finishes joining your WiFi** — almost always a wrong home
  WiFi password. The app times out and returns you to the setup screen to retry.
- **Page won't load in the control panel** — tap refresh; if it persists, go
  back to setup and reconnect.
