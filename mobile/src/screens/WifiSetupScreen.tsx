import React, {useCallback, useEffect, useRef, useState} from 'react';
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
  Surface,
  SegmentedButtons,
} from 'react-native-paper';
import type {StackScreenProps} from '@react-navigation/stack';

import type {RootStackParamList} from '../navigation/AppNavigator';
import {useAppStore} from '../store/useAppStore';
import {requestWifiPermissions} from '../services/permissions';
import {
  getCurrentSsid,
  getNetworkInfo,
  connectToFirmwareAp,
  bindToWifi,
  releaseForcedWifi,
} from '../services/wifiManager';
import {
  setActiveBaseUrl,
  getActiveBaseUrl,
  getInfoAt,
  postWifi,
  waitForStation,
  pingFirmware,
  probeFirstReachable,
  probeUntilReachable,
} from '../services/firmwareApi';
import {
  FIRMWARE_AP_SSID,
  FIRMWARE_AP_URL,
  FIRMWARE_MDNS_URL,
} from '../constants';

type Props = StackScreenProps<RootStackParamList, 'Setup'>;

type Phase = 'probing' | 'joining-ap' | 'need-setup' | 'submitting' | 'error';
type Mode = 'wifi' | 'hotspot';
type HotspotStep = 'form' | 'saving' | 'instructions' | 'finding';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function WifiSetupScreen({navigation}: Props) {
  const setHomeSsid = useAppStore(s => s.setHomeSsid);
  const setHomePassword = useAppStore(s => s.setHomePassword);
  const setHotspotSsidStore = useAppStore(s => s.setHotspotSsid);
  const setHotspotPasswordStore = useAppStore(s => s.setHotspotPassword);
  const setLastStaIp = useAppStore(s => s.setLastStaIp);
  const setFirmwareVersion = useAppStore(s => s.setFirmwareVersion);
  const hydrate = useAppStore(s => s.hydrate);

  const [phase, setPhase] = useState<Phase>('probing');
  const [status, setStatus] = useState('Looking for the converter…');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('wifi');

  // Home-WiFi tab
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Hotspot tab
  const [hsSsid, setHsSsid] = useState('');
  const [hsPass, setHsPass] = useState('');
  const [showHsPass, setShowHsPass] = useState(false);
  const [hotspotStep, setHotspotStep] = useState<HotspotStep>('form');
  const [hotspotError, setHotspotError] = useState<string | null>(null);

  const startedRef = useRef(false);

  const goConnected = useCallback(
    (staIp?: string) => {
      navigation.replace('WebUi', staIp ? {staIp} : undefined);
    },
    [navigation],
  );

  // Ensure we can actually reach the converter over its AP before a POST.
  // Android can drop an internet-less AP while the user types; re-bind, re-check
  // and rejoin if needed. For a home-network connection this is a no-op.
  const ensureOnConverterAp = useCallback(async (): Promise<boolean> => {
    if (getActiveBaseUrl() !== FIRMWARE_AP_URL) {
      return true;
    }
    await bindToWifi();
    if (await pingFirmware(4000)) {
      return true;
    }
    try {
      await connectToFirmwareAp();
      await bindToWifi();
    } catch {
      // handled by the reachability check below
    }
    return pingFirmware(6000);
  }, []);

  const bootstrap = useCallback(async () => {
    setError(null);
    setFormError(null);
    setPhase('probing');
    setStatus('Looking for the converter…');

    await hydrate();
    const granted = await requestWifiPermissions();

    let detectedHomeSsid: string | null = null;
    if (granted) {
      const cur = await getCurrentSsid();
      if (cur && cur !== FIRMWARE_AP_SSID) {
        detectedHomeSsid = cur;
      }
    }

    const {lastStaIp} = useAppStore.getState();
    const candidates = [FIRMWARE_AP_URL];
    if (lastStaIp) {
      candidates.push(`http://${lastStaIp}`);
    }
    candidates.push(FIRMWARE_MDNS_URL);

    let baseUrl = await probeFirstReachable(candidates, 3000);
    console.log(
      `[fj-ocs] probe candidates [${candidates.join(', ')}] -> ${
        baseUrl ?? 'none reachable'
      }`,
    );

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
    console.log(
      `[fj-ocs] active converter address = ${baseUrl}${
        baseUrl === FIRMWARE_AP_URL ? ' (setup AP)' : ' (home network)'
      }`,
    );
    if (baseUrl === FIRMWARE_AP_URL) {
      await bindToWifi();
    }

    let info;
    try {
      info = await getInfoAt(baseUrl, 5000);
    } catch (e) {
      setPhase('error');
      setError(messageOf(e));
      return;
    }
    setFirmwareVersion(info.fwVersion ?? null);

    if (info.staOk && info.staIp && info.staIp !== '0.0.0.0') {
      setLastStaIp(info.staIp);
      goConnected(info.staIp);
      return;
    }

    const store = useAppStore.getState();
    setSsid(detectedHomeSsid || store.homeSsid || '');
    setPassword(store.homePassword || '');
    setHsSsid(store.hotspotSsid || '');
    setHsPass(store.hotspotPassword || '');
    setHotspotStep('form');
    setPhase('need-setup');
  }, [hydrate, goConnected, setFirmwareVersion, setLastStaIp]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    bootstrap();
  }, [bootstrap]);

  // --- Home WiFi connect -----------------------------------------------------
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
    const net = await getNetworkInfo();
    console.log(
      `[fj-ocs] POST /api/wifi -> ${getActiveBaseUrl()} | phone SSID=${
        net.ssid ?? '?'
      } ip=${net.ip ?? '?'}`,
    );

    setStatus('Reconnecting to the converter…');
    if (!(await ensureOnConverterAp())) {
      setPhase('need-setup');
      setFormError(
        `Lost the connection to the converter. Make sure you’re joined to “${FIRMWARE_AP_SSID}”, then try again.`,
      );
      return;
    }

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
    ensureOnConverterAp,
  ]);

  // --- Hotspot: save credentials to the converter ----------------------------
  const handleSaveHotspot = useCallback(async () => {
    const trimmed = hsSsid.trim();
    if (!trimmed) {
      setHotspotError('Enter your phone hotspot’s name (SSID).');
      return;
    }
    setHotspotError(null);
    setHotspotSsidStore(trimmed);
    setHotspotPasswordStore(hsPass);

    setHotspotStep('saving');
    const net = await getNetworkInfo();
    console.log(
      `[fj-ocs] hotspot save -> ${getActiveBaseUrl()} | phone SSID=${
        net.ssid ?? '?'
      } ip=${net.ip ?? '?'}`,
    );

    if (!(await ensureOnConverterAp())) {
      setHotspotStep('form');
      setHotspotError(
        `Lost the connection to the converter. Rejoin “${FIRMWARE_AP_SSID}” and try again.`,
      );
      return;
    }

    try {
      await postWifi(trimmed, hsPass);
    } catch (e) {
      setHotspotStep('form');
      setHotspotError(messageOf(e));
      return;
    }

    // Credentials saved. The converter will keep retrying and will join the
    // hotspot once it's switched on. Release the AP binding so traffic can move
    // to the hotspot network next.
    await releaseForcedWifi();
    setHotspotStep('instructions');
  }, [hsSsid, hsPass, setHotspotSsidStore, setHotspotPasswordStore, ensureOnConverterAp]);

  // --- Hotspot: find the converter once the hotspot is on --------------------
  const handleFindConverter = useCallback(async () => {
    setHotspotError(null);
    setHotspotStep('finding');

    const {lastStaIp} = useAppStore.getState();
    const candidates = [FIRMWARE_MDNS_URL];
    if (lastStaIp) {
      candidates.push(`http://${lastStaIp}`);
    }
    console.log(`[fj-ocs] hotspot find: probing [${candidates.join(', ')}]`);

    const url = await probeUntilReachable(candidates, {totalMs: 45000});
    if (!url) {
      setHotspotStep('instructions');
      setHotspotError(
        'Couldn’t find the converter on your hotspot. Make sure the hotspot is on with the exact name and password you entered, then try again.',
      );
      return;
    }

    setActiveBaseUrl(url);
    let info;
    try {
      info = await getInfoAt(url, 5000);
    } catch {
      setHotspotStep('instructions');
      setHotspotError('Found the converter but lost it. Try again.');
      return;
    }
    setFirmwareVersion(info.fwVersion ?? null);
    if (info.staIp && info.staIp !== '0.0.0.0') {
      setLastStaIp(info.staIp);
    }
    goConnected(info.staIp);
  }, [goConnected, setFirmwareVersion, setLastStaIp]);

  const openHotspotSettings = useCallback(() => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.TETHER_SETTINGS').catch(() => {
        Linking.openSettings().catch(() => {});
      });
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, []);

  const submitting = phase === 'submitting';
  const hotspotBusy = hotspotStep === 'saving' || hotspotStep === 'finding';
  const tabsDisabled = submitting || hotspotBusy;

  if (phase === 'probing' || phase === 'joining-ap') {
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
        <View style={styles.center}>
          <ActivityIndicator animating size="large" />
          <Text variant="bodyMedium" style={styles.centerText}>
            {status}
          </Text>
        </View>
      </View>
    );
  }

  if (phase === 'error') {
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
      </View>
    );
  }

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
          <SegmentedButtons
            value={mode}
            onValueChange={v => setMode(v as Mode)}
            style={styles.tabs}
            buttons={[
              {value: 'wifi', label: 'Home WiFi', disabled: tabsDisabled},
              {value: 'hotspot', label: 'Phone hotspot', disabled: tabsDisabled},
            ]}
          />

          {mode === 'wifi' ? (
            <View>
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
            </View>
          ) : (
            <View>
              {hotspotStep === 'finding' ? (
                <Surface style={styles.statusCard} elevation={1}>
                  <ActivityIndicator animating />
                  <Text variant="bodyMedium" style={styles.statusText}>
                    Looking for the converter on your hotspot…
                  </Text>
                </Surface>
              ) : hotspotStep === 'instructions' ? (
                <View>
                  <Text variant="bodyMedium" style={styles.intro}>
                    Saved to the converter. Now switch on your phone’s hotspot so
                    it can join:
                  </Text>
                  <Text variant="bodyMedium" style={styles.steps}>
                    1. Open hotspot settings.{'\n'}
                    2. Set the name to “{hsSsid}” and the password to match what
                    you entered.{'\n'}
                    3. Turn the hotspot on, then come back and tap “Find
                    converter”.
                  </Text>
                  {hotspotError ? (
                    <HelperText type="error" visible style={styles.error}>
                      {hotspotError}
                    </HelperText>
                  ) : null}
                  <Button
                    mode="outlined"
                    icon="cellphone-wireless"
                    onPress={openHotspotSettings}
                    style={styles.button}>
                    Open hotspot settings
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleFindConverter}
                    style={styles.button}>
                    Find converter
                  </Button>
                  <Button onPress={() => setHotspotStep('form')}>
                    Edit hotspot details
                  </Button>
                </View>
              ) : (
                <View>
                  <Text variant="bodyMedium" style={styles.intro}>
                    Use your phone’s hotspot as the converter’s network — handy
                    where there’s no WiFi. Enter the hotspot’s name and password
                    (set these in your phone’s hotspot settings).
                  </Text>
                  <TextInput
                    label="Hotspot name (SSID)"
                    value={hsSsid}
                    onChangeText={setHsSsid}
                    mode="outlined"
                    autoCapitalize="none"
                    autoCorrect={false}
                    disabled={hotspotStep === 'saving'}
                    style={styles.input}
                  />
                  <TextInput
                    label="Hotspot password"
                    value={hsPass}
                    onChangeText={setHsPass}
                    mode="outlined"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showHsPass}
                    disabled={hotspotStep === 'saving'}
                    right={
                      <TextInput.Icon
                        icon={showHsPass ? 'eye-off' : 'eye'}
                        onPress={() => setShowHsPass(v => !v)}
                        forceTextInputFocus={false}
                      />
                    }
                    style={styles.input}
                  />
                  <HelperText type="info" visible>
                    These must exactly match your phone’s hotspot. iOS hotspot
                    names come from your device name.
                  </HelperText>
                  {hotspotError ? (
                    <HelperText type="error" visible style={styles.error}>
                      {hotspotError}
                    </HelperText>
                  ) : null}
                  <Button
                    mode="contained"
                    onPress={handleSaveHotspot}
                    disabled={hotspotStep === 'saving'}
                    loading={hotspotStep === 'saving'}
                    style={styles.button}>
                    {hotspotStep === 'saving'
                      ? 'Saving…'
                      : 'Save to converter'}
                  </Button>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  tabs: {marginBottom: 20},
  intro: {marginBottom: 16, opacity: 0.8},
  steps: {marginBottom: 12},
  input: {marginTop: 8},
  error: {marginTop: 4},
  button: {marginTop: 12},
  statusCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {marginLeft: 12, flexShrink: 1},
});
