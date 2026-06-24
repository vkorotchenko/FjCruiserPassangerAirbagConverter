import React, {useEffect, useState, useCallback} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Platform,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Appbar,
  Text,
  TextInput,
  Button,
  HelperText,
  ActivityIndicator,
  Portal,
  Dialog,
  Surface,
} from 'react-native-paper';
import type {StackScreenProps} from '@react-navigation/stack';

import type {RootStackParamList} from '../navigation/AppNavigator';
import {useAppStore} from '../store/useAppStore';
import {requestWifiPermissions} from '../services/permissions';
import {
  getCurrentSsid,
  connectToFirmwareAp,
  bindToWifi,
} from '../services/wifiManager';
import {postWifi, waitForStation, pingFirmware} from '../services/firmwareApi';
import {FIRMWARE_AP_SSID, FIRMWARE_AP_PASS} from '../constants';

type Props = StackScreenProps<RootStackParamList, 'Setup'>;

type Phase = 'idle' | 'joining' | 'sending' | 'waiting' | 'error';

const UNREACHABLE = 'unreachable';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export default function WifiSetupScreen({navigation}: Props) {
  const setHomeSsid = useAppStore(state => state.setHomeSsid);
  const setHomePassword = useAppStore(state => state.setHomePassword);
  const setLastStaIp = useAppStore(state => state.setLastStaIp);
  const hydrate = useAppStore(state => state.hydrate);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [manualVisible, setManualVisible] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const busy = phase === 'joining' || phase === 'sending' || phase === 'waiting';

  // On mount: load any saved SSID/password, ask for permissions, and try to
  // pre-fill the SSID with the phone's current network (skipping the firmware's
  // own AP). A freshly-detected home SSID wins over the saved one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrate();
      const {homeSsid: savedSsid, homePassword: savedPass} =
        useAppStore.getState();
      if (!cancelled) {
        if (savedSsid) {
          setSsid(savedSsid);
        }
        if (savedPass) {
          setPassword(savedPass);
        }
      }
      const granted = await requestWifiPermissions();
      const current = granted ? await getCurrentSsid() : null;
      if (!cancelled && current && current !== FIRMWARE_AP_SSID) {
        setSsid(current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // Poll until the firmware AP answers, or give up so the caller can offer a
  // manual-join fallback.
  const ensureReachable = useCallback(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await pingFirmware()) {
        return;
      }
      await delay(1500);
    }
    throw new Error(UNREACHABLE);
  }, []);

  // Shared continuation once the phone is (believed to be) on the firmware AP:
  // confirm reachability, push credentials, then wait for the station join.
  const continueAfterAp = useCallback(
    async (targetSsid: string, targetPass: string) => {
      await bindToWifi();
      setStatus('Reaching the converter…');
      await ensureReachable();

      setPhase('sending');
      setStatus('Sending your WiFi details to the converter…');
      await postWifi(targetSsid, targetPass);

      setPhase('waiting');
      setStatus(`Waiting for the converter to join “${targetSsid}”…`);
      const info = await waitForStation({
        onTick: tick => {
          if (tick && !tick.staOk) {
            setStatus(`Converter online, joining “${targetSsid}”…`);
          }
        },
      });

      setLastStaIp(info.staIp);
      navigation.replace('WebUi', {staIp: info.staIp});
    },
    [ensureReachable, navigation, setLastStaIp],
  );

  const handleConnect = useCallback(async () => {
    const trimmed = ssid.trim();
    if (!trimmed) {
      setError('Enter your home WiFi name (SSID).');
      return;
    }
    setError(null);
    setManualError(null);
    setHomeSsid(trimmed);
    setHomePassword(password);

    setPhase('joining');
    setStatus(`Joining the converter’s WiFi (${FIRMWARE_AP_SSID})…`);
    try {
      await connectToFirmwareAp();
    } catch {
      // Programmatic join failed (common on some OEMs / iOS): fall back to the
      // guided manual join.
      setPhase('idle');
      setStatus('');
      setManualVisible(true);
      return;
    }

    try {
      await continueAfterAp(trimmed, password);
    } catch (err) {
      if (messageOf(err) === UNREACHABLE) {
        setPhase('idle');
        setStatus('');
        setManualVisible(true);
      } else {
        setPhase('error');
        setError(messageOf(err));
      }
    }
  }, [ssid, password, setHomeSsid, setHomePassword, continueAfterAp]);

  const handleManualContinue = useCallback(async () => {
    setManualBusy(true);
    setManualError(null);
    try {
      await continueAfterAp(ssid.trim(), password);
      setManualVisible(false);
    } catch (err) {
      if (messageOf(err) === UNREACHABLE) {
        setManualError(
          `Still can’t reach the converter. Make sure you joined “${FIRMWARE_AP_SSID}”, then try again.`,
        );
      } else {
        setManualVisible(false);
        setPhase('error');
        setError(messageOf(err));
      }
    } finally {
      setManualBusy(false);
    }
  }, [continueAfterAp, ssid, password]);

  const openWifiSettings = useCallback(() => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => {
        Linking.openSettings().catch(() => {});
      });
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, []);

  return (
    <View style={styles.flex}>
      <Appbar.Header>
        <Appbar.Content title="FJ OCS Setup" />
        <Appbar.Action
          icon="cog"
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate('Settings')}
        />
      </Appbar.Header>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <Text variant="titleMedium" style={styles.heading}>
            Put the converter on your WiFi
          </Text>
          <Text variant="bodyMedium" style={styles.intro}>
            Enter your home WiFi name and password. The app connects to the
            converter and hands it these details, then opens its control panel.
          </Text>

          <TextInput
            label="WiFi name (SSID)"
            value={ssid}
            onChangeText={setSsid}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            disabled={busy}
            style={styles.input}
          />

          <TextInput
            label="WiFi password"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            disabled={busy}
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword(v => !v)}
                forceTextInputFocus={false}
              />
            }
            style={styles.input}
          />
          <HelperText type="info" visible>
            Leave the password blank only for open networks.
          </HelperText>

          {error ? (
            <HelperText type="error" visible style={styles.error}>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            onPress={handleConnect}
            disabled={busy}
            loading={busy}
            style={styles.button}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>

          {busy ? (
            <Surface style={styles.statusCard} elevation={1}>
              <ActivityIndicator animating />
              <Text variant="bodyMedium" style={styles.statusText}>
                {status}
              </Text>
            </Surface>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Portal>
        <Dialog
          visible={manualVisible}
          onDismiss={() => (manualBusy ? undefined : setManualVisible(false))}>
          <Dialog.Title>Join the converter’s WiFi</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogText}>
              Automatic join didn’t work. Please connect manually:
            </Text>
            <Text variant="bodyMedium">
              1. Open WiFi settings.{'\n'}
              2. Join “{FIRMWARE_AP_SSID}” (password “{FIRMWARE_AP_PASS}”).{'\n'}
              3. Return here and tap Continue.
            </Text>
            {manualError ? (
              <HelperText type="error" visible style={styles.dialogError}>
                {manualError}
              </HelperText>
            ) : null}
            {manualBusy ? (
              <View style={styles.dialogBusy}>
                <ActivityIndicator animating />
                <Text variant="bodyMedium" style={styles.statusText}>
                  {status || 'Working…'}
                </Text>
              </View>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={openWifiSettings} disabled={manualBusy}>
              WiFi settings
            </Button>
            <Button onPress={handleManualContinue} loading={manualBusy}>
              Continue
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  content: {padding: 20},
  heading: {marginBottom: 8},
  intro: {marginBottom: 20, opacity: 0.8},
  input: {marginTop: 8},
  error: {marginTop: 4},
  button: {marginTop: 16},
  statusCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {marginLeft: 12, flexShrink: 1},
  dialogText: {marginBottom: 12},
  dialogError: {marginTop: 8},
  dialogBusy: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
