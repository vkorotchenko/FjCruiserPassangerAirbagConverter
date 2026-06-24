import React, {useCallback, useState} from 'react';
import {View, StyleSheet, Platform, Linking} from 'react-native';
import {
  Text,
  Button,
  Surface,
  Portal,
  Dialog,
  ProgressBar,
  HelperText,
  Divider,
} from 'react-native-paper';

import {useAppStore} from '../store/useAppStore';
import {formatVersion} from '../services/semver';
import {computeUpdateOffer} from '../services/updateOffer';
import {
  checkForMobileUpdate,
  prepareAppPayload,
  cancelAppUpdatePreparation,
  getReadyAppApkPath,
} from '../services/mobileUpdateController';
import {
  installApk,
  canRequestInstalls,
  openInstallPermissionSettings,
} from '../services/apkInstaller';

function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return '';
  }
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * App self-update UI: shows the running app version, a check-for-updates
 * affordance, and (when a newer GitHub release exists) drives the
 * download → verify → install flow. Android installs the APK; iOS opens the
 * release page.
 *
 * `embedded` drops the outer Surface/margins so it can sit inside a Dialog.
 */
export default function AppUpdateSection({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const appVersion = useAppStore(s => s.appVersion);
  const latestVersion = useAppStore(s => s.latestAppReleaseVersion);
  const latestUrl = useAppStore(s => s.latestAppReleaseUrl);
  const releaseSize = useAppStore(s => s.latestAppReleaseSize);
  const updateState = useAppStore(s => s.appUpdateState);
  const updateError = useAppStore(s => s.appUpdateError);
  const progress = useAppStore(s => s.appUpdateProgress);
  const bytesReceived = useAppStore(s => s.appUpdateBytesReceived);
  const bytesTotal = useAppStore(s => s.appUpdateBytesTotal);

  const [dialogVisible, setDialogVisible] = useState(false);
  const [installHint, setInstallHint] = useState<string | null>(null);

  const offer = computeUpdateOffer(appVersion, latestVersion);
  const updateAvailable =
    offer.kind === 'update' || offer.kind === 'unknown-current';
  const checking = updateState === 'checking';
  const busy = updateState === 'downloading' || updateState === 'verifying';
  const isAndroid = Platform.OS === 'android';

  const onCheck = useCallback(async () => {
    const result = await checkForMobileUpdate({force: true});
    const s = useAppStore.getState();
    const freshOffer = computeUpdateOffer(
      s.appVersion,
      s.latestAppReleaseVersion,
    );
    if (
      result.ok &&
      (freshOffer.kind === 'update' || freshOffer.kind === 'unknown-current')
    ) {
      setInstallHint(null);
      setDialogVisible(true);
    }
  }, []);

  const onOpenDialog = useCallback(() => {
    setInstallHint(null);
    setDialogVisible(true);
  }, []);

  const onCloseDialog = useCallback(() => {
    if (busy) {
      cancelAppUpdatePreparation();
    }
    setDialogVisible(false);
  }, [busy]);

  const onDownload = useCallback(() => {
    setInstallHint(null);
    prepareAppPayload();
  }, []);

  const onInstall = useCallback(async () => {
    if (!isAndroid) {
      if (latestUrl) {
        Linking.openURL(latestUrl).catch(() => {});
      }
      return;
    }
    const path = getReadyAppApkPath();
    if (!path) {
      setInstallHint('No verified file to install. Download again.');
      return;
    }
    const allowed = await canRequestInstalls();
    if (!allowed) {
      setInstallHint(
        'Allow installing unknown apps for this app, then tap Install again.',
      );
      await openInstallPermissionSettings();
      return;
    }
    try {
      await installApk(path);
      // The OS installer takes over; this process is killed on confirm.
    } catch (e) {
      setInstallHint(e instanceof Error ? e.message : 'Install failed.');
    }
  }, [isAndroid, latestUrl]);

  const primaryLabel = isAndroid ? 'Download' : 'Open release';

  const body = (
    <>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="labelLarge">App version</Text>
          <Text variant="bodyMedium" style={styles.dim}>
            {formatVersion(appVersion)}
            {updateAvailable && latestVersion
              ? `  •  ${formatVersion(latestVersion)} available`
              : ''}
          </Text>
        </View>
        <Button
          mode={updateAvailable ? 'contained' : 'outlined'}
          compact
          loading={checking}
          disabled={checking}
          onPress={updateAvailable ? onOpenDialog : onCheck}>
          {updateAvailable ? 'Update' : 'Check'}
        </Button>
      </View>
      {updateState === 'error' && updateError && !dialogVisible ? (
        <HelperText type="error" visible style={styles.dim}>
          {updateError}
        </HelperText>
      ) : null}

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={onCloseDialog}>
          <Dialog.Title>App update</Dialog.Title>
          <Dialog.Content>
            {updateState === 'ready' ? (
              <Text variant="bodyMedium">
                {formatVersion(latestVersion)} downloaded and verified.
                {isAndroid
                  ? ' Install now?'
                  : ' Open the release page to update.'}
              </Text>
            ) : busy ? (
              <View>
                <Text variant="bodyMedium" style={styles.dim}>
                  {updateState === 'downloading'
                    ? `Downloading ${formatVersion(latestVersion)}…`
                    : 'Verifying…'}
                </Text>
                <ProgressBar
                  progress={progress}
                  indeterminate={updateState === 'verifying'}
                  style={styles.progress}
                />
                {bytesTotal ? (
                  <Text variant="bodySmall" style={styles.dim}>
                    {formatBytes(bytesReceived)} / {formatBytes(bytesTotal)}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text variant="bodyMedium">
                {formatVersion(latestVersion)} is available
                {releaseSize ? ` (${formatBytes(releaseSize)})` : ''}.
                {isAndroid
                  ? ' Download and install it?'
                  : ' Open the release page to update.'}
              </Text>
            )}

            {updateState === 'error' && updateError ? (
              <HelperText type="error" visible style={styles.dialogHint}>
                {updateError}
              </HelperText>
            ) : null}
            {installHint ? (
              <HelperText type="info" visible style={styles.dialogHint}>
                {installHint}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Divider />
          <Dialog.Actions>
            {busy ? (
              <Button onPress={onCloseDialog}>Cancel</Button>
            ) : updateState === 'ready' ? (
              <>
                <Button onPress={onCloseDialog}>Later</Button>
                <Button mode="contained" onPress={onInstall}>
                  {isAndroid ? 'Install' : 'Open release'}
                </Button>
              </>
            ) : updateState === 'error' ? (
              <>
                <Button onPress={onCloseDialog}>Close</Button>
                <Button onPress={isAndroid ? onDownload : onInstall}>
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Button onPress={onCloseDialog}>Later</Button>
                <Button mode="contained" onPress={isAndroid ? onDownload : onInstall}>
                  {primaryLabel}
                </Button>
              </>
            )}
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );

  return embedded ? (
    <View style={styles.embedded}>{body}</View>
  ) : (
    <Surface style={styles.card} elevation={1}>
      {body}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 28,
    padding: 16,
    borderRadius: 12,
  },
  embedded: {paddingTop: 4},
  row: {flexDirection: 'row', alignItems: 'center'},
  flex: {flex: 1},
  dim: {opacity: 0.7},
  progress: {marginTop: 12, marginBottom: 8, height: 6, borderRadius: 3},
  dialogHint: {paddingHorizontal: 0},
});
