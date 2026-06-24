import React, {useCallback, useState} from 'react';
import {View, StyleSheet, Linking} from 'react-native';
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
  checkForFirmwareUpdate,
  prepareAndFlashFirmware,
  cancelFirmwareUpdate,
} from '../services/firmwareUpdateController';

function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) {
    return '';
  }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Firmware OTA UI: shows the converter's current firmware version vs. the latest
 * GitHub release and drives download → verify → flash → reboot. Flashing
 * requires the converter to be reachable and the phone to have internet.
 *
 * `embedded` drops the outer Surface so it can sit inside a Settings card.
 */
export default function FirmwareUpdateSection({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const fwVersion = useAppStore(s => s.firmwareVersion);
  const latestVersion = useAppStore(s => s.latestFwVersion);
  const latestUrl = useAppStore(s => s.latestFwUrl);
  const releaseSize = useAppStore(s => s.latestFwSize);
  const state = useAppStore(s => s.firmwareUpdateState);
  const error = useAppStore(s => s.firmwareUpdateError);
  const progress = useAppStore(s => s.firmwareUpdateProgress);
  const bytesDone = useAppStore(s => s.firmwareUpdateBytesDone);
  const bytesTotal = useAppStore(s => s.firmwareUpdateBytesTotal);

  const [dialogVisible, setDialogVisible] = useState(false);

  const offer = computeUpdateOffer(fwVersion, latestVersion);
  const updateAvailable =
    offer.kind === 'update' || offer.kind === 'unknown-current';
  const connected = fwVersion !== null;
  const checking = state === 'checking';
  const busy =
    state === 'downloading' ||
    state === 'verifying' ||
    state === 'flashing' ||
    state === 'rebooting';
  const cancelable = state === 'downloading' || state === 'verifying';

  const onCheck = useCallback(async () => {
    const result = await checkForFirmwareUpdate({force: true});
    const s = useAppStore.getState();
    const fresh = computeUpdateOffer(s.firmwareVersion, s.latestFwVersion);
    if (
      result.ok &&
      (fresh.kind === 'update' || fresh.kind === 'unknown-current')
    ) {
      setDialogVisible(true);
    }
  }, []);

  const onCloseDialog = useCallback(() => {
    if (cancelable) {
      cancelFirmwareUpdate();
    }
    setDialogVisible(false);
  }, [cancelable]);

  const onFlash = useCallback(() => {
    prepareAndFlashFirmware();
  }, []);

  const stageLabel = () => {
    switch (state) {
      case 'downloading':
        return `Downloading firmware ${formatVersion(latestVersion)}…`;
      case 'verifying':
        return 'Verifying download…';
      case 'flashing':
        return 'Flashing the converter — keep it powered…';
      case 'rebooting':
        return 'Converter rebooting…';
      default:
        return '';
    }
  };

  const body = (
    <>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="labelLarge">Converter firmware</Text>
          <Text variant="bodyMedium" style={styles.dim}>
            {connected ? formatVersion(fwVersion) : 'Not connected'}
            {updateAvailable && latestVersion
              ? `  •  ${formatVersion(latestVersion)} available`
              : ''}
          </Text>
        </View>
        <Button
          mode={updateAvailable ? 'contained' : 'outlined'}
          compact
          loading={checking}
          disabled={checking || busy}
          onPress={updateAvailable ? () => setDialogVisible(true) : onCheck}>
          {updateAvailable ? 'Update' : 'Check'}
        </Button>
      </View>
      {state === 'error' && error && !dialogVisible ? (
        <HelperText type="error" visible style={styles.dim}>
          {error}
        </HelperText>
      ) : null}

      <Portal>
        <Dialog visible={dialogVisible} onDismiss={onCloseDialog}>
          <Dialog.Title>Firmware update</Dialog.Title>
          <Dialog.Content>
            {state === 'done' ? (
              <Text variant="bodyMedium">
                Converter updated to {formatVersion(fwVersion)}.
              </Text>
            ) : busy ? (
              <View>
                <Text variant="bodyMedium" style={styles.dim}>
                  {stageLabel()}
                </Text>
                <ProgressBar
                  progress={progress}
                  indeterminate={state === 'verifying' || state === 'rebooting'}
                  style={styles.progress}
                />
                {bytesTotal ? (
                  <Text variant="bodySmall" style={styles.dim}>
                    {formatBytes(bytesDone)} / {formatBytes(bytesTotal)}
                  </Text>
                ) : null}
                {state === 'flashing' || state === 'rebooting' ? (
                  <HelperText type="error" visible style={styles.warn}>
                    Do not power off the converter or close the app.
                  </HelperText>
                ) : null}
              </View>
            ) : (
              <View>
                <Text variant="bodyMedium">
                  {formatVersion(latestVersion)} is available
                  {releaseSize ? ` (${formatBytes(releaseSize)})` : ''}.
                </Text>
                {!connected ? (
                  <HelperText type="info" visible style={styles.hint}>
                    Connect to the converter first to flash it.
                  </HelperText>
                ) : (
                  <HelperText type="info" visible style={styles.hint}>
                    The converter will flash and reboot. Keep it powered and stay
                    on this screen.
                  </HelperText>
                )}
              </View>
            )}

            {state === 'error' && error ? (
              <HelperText type="error" visible style={styles.hint}>
                {error}
              </HelperText>
            ) : null}
          </Dialog.Content>
          <Divider />
          <Dialog.Actions>
            {busy ? (
              cancelable ? (
                <Button onPress={onCloseDialog}>Cancel</Button>
              ) : (
                <Button disabled>Working…</Button>
              )
            ) : state === 'done' ? (
              <Button mode="contained" onPress={() => setDialogVisible(false)}>
                Done
              </Button>
            ) : state === 'error' ? (
              <>
                <Button onPress={() => setDialogVisible(false)}>Close</Button>
                <Button onPress={onFlash} disabled={!connected}>
                  Retry
                </Button>
              </>
            ) : (
              <>
                {latestUrl ? (
                  <Button onPress={() => Linking.openURL(latestUrl).catch(() => {})}>
                    Notes
                  </Button>
                ) : null}
                <Button onPress={() => setDialogVisible(false)}>Later</Button>
                <Button mode="contained" onPress={onFlash} disabled={!connected}>
                  Flash
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
  card: {marginTop: 28, padding: 16, borderRadius: 12},
  embedded: {paddingTop: 4},
  row: {flexDirection: 'row', alignItems: 'center'},
  flex: {flex: 1},
  dim: {opacity: 0.75},
  progress: {marginTop: 12, marginBottom: 8, height: 6, borderRadius: 3},
  hint: {paddingHorizontal: 0},
  warn: {paddingHorizontal: 0},
});
