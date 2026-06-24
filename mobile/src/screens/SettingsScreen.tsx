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
import {getInfo} from '../services/firmwareApi';
import {formatVersion} from '../services/semver';
import AppUpdateSection from '../components/AppUpdateSection';

type Props = StackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({navigation}: Props) {
  const homeSsid = useAppStore(s => s.homeSsid);
  const homePassword = useAppStore(s => s.homePassword);
  const clearStoredWifi = useAppStore(s => s.clearStoredWifi);

  const hasSaved = homeSsid.length > 0 || homePassword.length > 0;

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [snackVisible, setSnackVisible] = useState(false);
  const [fwVersion, setFwVersion] = useState<string | null>(null);

  // Best-effort firmware version. Only resolves when the phone can currently
  // reach the converter (on its AP); otherwise stays null ("not connected").
  useEffect(() => {
    let cancelled = false;
    getInfo(4000)
      .then(info => {
        if (!cancelled) {
          setFwVersion(info.fwVersion ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFwVersion(null);
        }
      });
    return () => {
      cancelled = true;
    };
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

        {/* Firmware ----------------------------------------------------- */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Converter firmware
          </Text>
          <Text variant="bodyMedium" style={styles.dim}>
            {fwVersion
              ? `Version ${formatVersion(fwVersion)}`
              : 'Not connected to the converter. Connect to see its firmware version.'}
          </Text>
        </Surface>

        {/* App update (OTA) -------------------------------------------- */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            App update
          </Text>
          <Divider style={styles.divider} />
          <AppUpdateSection embedded />
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
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  cardTitle: {marginBottom: 8},
  dim: {opacity: 0.75},
  action: {marginTop: 16, alignSelf: 'flex-start'},
  divider: {marginBottom: 4},
});
