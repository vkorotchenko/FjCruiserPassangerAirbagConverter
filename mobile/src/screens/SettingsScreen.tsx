import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {
  Appbar,
  Text,
  Button,
  Surface,
  Divider,
  Portal,
  Dialog,
  Snackbar,
} from 'react-native-paper';
import type {StackScreenProps} from '@react-navigation/stack';

import type {RootStackParamList} from '../navigation/AppNavigator';
import {useAppStore} from '../store/useAppStore';
import {formatVersion} from '../services/semver';
import {checkForFirmwareUpdate} from '../services/firmwareUpdateController';
import FirmwareUpdateSection from '../components/FirmwareUpdateSection';

type Props = StackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({navigation}: Props) {
  const homeSsid = useAppStore(s => s.homeSsid);
  const homePassword = useAppStore(s => s.homePassword);
  const clearStoredWifi = useAppStore(s => s.clearStoredWifi);
  const appVersion = useAppStore(s => s.appVersion);
  const appBuild = useAppStore(s => s.appBuildNumber);

  const hasSaved = homeSsid.length > 0 || homePassword.length > 0;

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [snackVisible, setSnackVisible] = useState(false);

  // Populate the converter's firmware version + latest release on entry
  // (best-effort; only reads the converter if it is reachable).
  useEffect(() => {
    checkForFirmwareUpdate().catch(() => {});
  }, []);

  const onClear = useCallback(async () => {
    await clearStoredWifi();
    setConfirmVisible(false);
    setSnackVisible(true);
  }, [clearStoredWifi]);

  return (
    <View style={styles.flex}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content title="Settings" />
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Saved WiFi --------------------------------------------------- */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Saved home WiFi
          </Text>
          <Text variant="bodyMedium" style={styles.dim}>
            {hasSaved
              ? `Network: ${homeSsid || '(unnamed)'}\nPassword: ${
                  homePassword ? '••••••••' : '(none)'
                }`
              : 'No saved network. Your details are remembered after the first successful setup.'}
          </Text>
          <Button
            mode="outlined"
            icon="delete-outline"
            disabled={!hasSaved}
            onPress={() => setConfirmVisible(true)}
            style={styles.action}>
            Clear saved WiFi
          </Button>
        </Surface>

        {/* Firmware update (OTA) --------------------------------------- */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Firmware update
          </Text>
          <Divider style={styles.divider} />
          <FirmwareUpdateSection embedded />
        </Surface>

        {/* App identity ------------------------------------------------ */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            App
          </Text>
          <Text variant="bodyMedium" style={styles.dim}>
            Version {formatVersion(appVersion)}
            {appBuild ? ` (build ${appBuild})` : ''}
          </Text>
        </Surface>
      </ScrollView>

      <Portal>
        <Dialog
          visible={confirmVisible}
          onDismiss={() => setConfirmVisible(false)}>
          <Dialog.Title>Clear saved WiFi?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This removes the saved network name and password from this app. It
              does not change what the converter has already stored.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmVisible(false)}>Cancel</Button>
            <Button onPress={onClear}>Clear</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={snackVisible}
        onDismiss={() => setSnackVisible(false)}
        duration={2500}>
        Saved WiFi cleared.
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  content: {padding: 16},
  card: {padding: 16, borderRadius: 12, marginBottom: 16},
  cardTitle: {marginBottom: 8},
  dim: {opacity: 0.75},
  action: {marginTop: 16, alignSelf: 'flex-start'},
  divider: {marginBottom: 4},
});
