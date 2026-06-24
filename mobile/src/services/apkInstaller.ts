import {NativeModules, Platform} from 'react-native';

// Thin JS wrapper around the Android `ApkInstaller` native module
// (android/app/src/main/java/com/fjocssetup/ApkInstallerModule.kt).
// All three operations are no-ops / throw on iOS — APK install is Android-only.

const {ApkInstaller} = NativeModules;

/**
 * Dispatch an install intent for the APK at `filePath`. Returns once the intent
 * has started; this process is killed when the user taps "Install". The caller
 * MUST have already verified `canRequestInstalls()` returns true.
 */
export async function installApk(filePath: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('APK install is Android-only');
  }
  if (!ApkInstaller?.installApk) {
    throw new Error('ApkInstaller native module not linked');
  }
  await ApkInstaller.installApk(filePath);
}

/**
 * True if this app may request package installs. API < 26: always true.
 * API 26+: reflects Settings → Install unknown apps. False on non-Android.
 */
export async function canRequestInstalls(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  if (!ApkInstaller?.canRequestInstalls) {
    return false;
  }
  return ApkInstaller.canRequestInstalls();
}

/**
 * Deeplink to the per-app "Install unknown apps" settings page. Returns after
 * dispatching the intent; re-check `canRequestInstalls()` afterwards.
 */
export async function openInstallPermissionSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  if (!ApkInstaller?.openInstallPermissionSettings) {
    return;
  }
  await ApkInstaller.openInstallPermissionSettings();
}
