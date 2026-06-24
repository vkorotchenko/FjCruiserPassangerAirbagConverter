package com.fjocssetup

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Bridges the React side to Android's package-install intent for the in-app
 * self-update flow.
 *
 *  - installApk(filePath): wrap the on-disk APK in a FileProvider URI and
 *    dispatch ACTION_VIEW. The system installer takes over; once the user taps
 *    "Install" this process is killed, so we never observe completion.
 *  - canRequestInstalls(): API 26+ requires per-app consent (Settings → Install
 *    unknown apps). Returns true on API < 26.
 *  - openInstallPermissionSettings(): deeplink to the consent page.
 */
class ApkInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ApkInstaller"

    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
                ?: return promise.reject("NO_ACTIVITY", "No current activity")
            val file = File(filePath)
            if (!file.exists()) {
                return promise.reject("FILE_MISSING", "APK not found at $filePath")
            }
            val authority = "${reactApplicationContext.packageName}.fileprovider"
            val uri: Uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            promise.resolve(true)
        } catch (err: Throwable) {
            promise.reject("INSTALL_FAILED", err.message, err)
        }
    }

    @ReactMethod
    fun canRequestInstalls(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                promise.resolve(reactApplicationContext.packageManager.canRequestPackageInstalls())
            } else {
                promise.resolve(true)
            }
        } catch (err: Throwable) {
            promise.reject("CHECK_FAILED", err.message, err)
        }
    }

    @ReactMethod
    fun openInstallPermissionSettings(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
                ?: return promise.reject("NO_ACTIVITY", "No current activity")
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${reactApplicationContext.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            promise.resolve(true)
        } catch (err: Throwable) {
            promise.reject("OPEN_FAILED", err.message, err)
        }
    }
}
