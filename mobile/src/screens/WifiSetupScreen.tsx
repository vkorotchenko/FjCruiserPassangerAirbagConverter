import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Appbar,
  Text,
  TextInput,
  Button,
  HelperText,
  ActivityIndicator,
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
import {
  setActiveBaseUrl,
  getInfoAt,
  postWifi,
  waitForStation,
  probeFirstReachable,
} from '../services/firmwareApi';
import {
  FIRMWARE_AP_SSID,
  FIRMWARE_AP_URL,
  FIRMWARE_MDNS_URL,
} from '../constants';

type Props = StackScreenProps<RootStackParamList, 'Setup'>;

type Phase = 'probing' | 'joining-ap' | 'need-setup' | 'submitting' | 'error';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function WifiSetupScreen({navigation}: Props) {
  const setHomeSsid = useAppStore(s => s.setHomeSsid);
  const setHomePassword = useAppStore(s => s.setHomePassword);
  const setLastStaIp = useAppStore(s => s.setLastStaIp);
  const setFirmwareVersion = useAppStore(s => s.setFirmwareVersion);
  const hydrate = useAppStore(s => s.hydrate);

  const [phase, setPhase] = useState<Phase>('probing');
  const [status, setStatus] = useState('Looking for the converter…');
  const [error, setError] = useState<string | null>(null);

  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const startedRef = useRef(false);

  const goConnected = useCallback(
    (staIp?: string) => {
      navigation.replace('WebUi', staIp ? {staIp} : undefined);
    },
    [navigation],
  );

  // Find the converter (direct on the home network, or via its AP), decide
  // whether it is already configured, and route accordingly.
  const bootstrap = useCallback(async () => {
    setError(null);
    setFormError(null);
    setPhase('probing');
    setStatus('Looking for the converter…');

    await hydrate();
    const granted = await requestWifiPermissions();

    // Capture the phone's current network *before* we might join the AP, so we
    // can pre-fill the home SSID on a fresh setup.
    let detectedHomeSsid: string | null = null;
    if (granted) {
      const cur = await getCurrentSsid();
      if (cur && cur !== FIRMWARE_AP_SSID) {
        detectedHomeSsid = cur;
      }
    }

    // Probe known addresses in parallel: the always-on AP, the last home IP,
    // and the mDNS name.
    const {lastStaIp} = useAppStore.getState();
    const candidates = [FIRMWARE_AP_URL];
    if (lastStaIp) {
      candidates.push(`http://${lastStaIp}`);
    }
    candidates.push(FIRMWARE_MDNS_URL);

    let baseUrl = await probeFirstReachable(candidates, 3000);

    // Not reachable anywhere → join the AP to (re)configure.
    if (!baseUrl) {
      setPhase('joining-ap');
      setStatus(`Joining the converter’s WiFi (${FIRMWARE_AP_SSID})…`);
      try {
        await connectToFirmwareAp();
        await bindToWifi();
      } catch {
        setPhase('error');
        setError(
          `Couldn’t join “${FIRMWARE_AP_SSID}”. Make sure the converter is powered and in range, then retry.`,
        );
        return;
      }
      baseUrl = await probeFirstReachable([FIRMWARE_AP_URL], 8000);
      if (!baseUrl) {
        setPhase('error');
        setError(
          'Joined the converter’s WiFi but couldn’t reach it. Power-cycle the converter and retry.',
        );
        return;
      }
    }

    setActiveBaseUrl(baseUrl);

    let info;
    try {
      info = await getInfoAt(baseUrl, 5000);
    } catch (e) {
      setPhase('error');
      setError(messageOf(e));
      return;
    }
    setFirmwareVersion(info.fwVersion ?? null);

    // Already on the home network → straight to the control panel.
    if (info.staOk && info.staIp && info.staIp !== '0.0.0.0') {
      setLastStaIp(info.staIp);
      goConnected(info.staIp);
      return;
    }

    // Needs configuring → show the form (pre-filled).
    const {homeSsid, homePassword} = useAppStore.getState();
    setSsid(detectedHomeSsid || homeSsid || '');
    setPassword(homePassword || '');
    setPhase('need-setup');
  }, [hydrate, goConnected, setFirmwareVersion, setLastStaIp]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    bootstrap();
  }, [bootstrap]);

  const handleConnect = useCallback(async () => {
    const trimmed = ssid.trim();
    if (!trimmed) {
      setFormError('Enter your home WiFi name (SSID).');
      return;
    }
    setFormError(null);
    setHomeSsid(trimmed);
    setHomePassword(password);

    setPhase('submitting');
    setStatus('Sending your WiFi details to the converter…');
    try {
      await postWifi(trimmed, password);
    } catch (e) {
      setPhase('need-setup');
      setFormError(messageOf(e));
      return;
    }

    setStatus(`Waiting for the converter to join “${trimmed}”…`);
    try {
      const info = await waitForStation({
        onTick: tick => {
          if (tick && !tick.staOk) {
            setStatus(`Converter online, joining “${trimmed}”…`);
          }
        },
      });
      setFirmwareVersion(info.fwVersion ?? null);
      setLastStaIp(info.staIp);
      goConnected(info.staIp);
    } catch (e) {
      setPhase('need-setup');
      setFormError(messageOf(e));
    }
  }, [
    ssid,
    password,
    setHomeSsid,
    setHomePassword,
    setFirmwareVersion,
    setLastStaIp,
    goConnected,
  ]);

  const submitting = phase === 'submitting';

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

      {phase === 'probing' || phase === 'joining-ap' ? (
        <View style={styles.center}>
          <ActivityIndicator animating size="large" />
          <Text variant="bodyMedium" style={styles.centerText}>
            {status}
          </Text>
        </View>
      ) : phase === 'error' ? (
        <View style={styles.center}>
          <Text variant="titleMedium" style={styles.errorTitle}>
            Can’t reach the converter
          </Text>
          <Text variant="bodyMedium" style={styles.centerText}>
            {error}
          </Text>
          <Button mode="contained" onPress={bootstrap} style={styles.retry}>
            Retry
          </Button>
        </View>
      ) : (
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
              Enter your home WiFi name and password. The converter joins your
              network and its control panel opens.
            </Text>

            <TextInput
              label="WiFi name (SSID)"
              value={ssid}
              onChangeText={setSsid}
              mode="outlined"
              autoCapitalize="none"
              autoCorrect={false}
              disabled={submitting}
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
              disabled={submitting}
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

            {formError ? (
              <HelperText type="error" visible style={styles.error}>
                {formError}
              </HelperText>
            ) : null}

            <Button
              mode="contained"
              onPress={handleConnect}
              disabled={submitting}
              loading={submitting}
              style={styles.button}>
              {submitting ? 'Connecting…' : 'Connect'}
            </Button>

            {submitting ? (
              <Surface style={styles.statusCard} elevation={1}>
                <ActivityIndicator animating />
                <Text variant="bodyMedium" style={styles.statusText}>
                  {status}
                </Text>
              </Surface>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centerText: {marginTop: 16, textAlign: 'center', opacity: 0.8},
  errorTitle: {marginBottom: 8, textAlign: 'center'},
  retry: {marginTop: 20},
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
});
