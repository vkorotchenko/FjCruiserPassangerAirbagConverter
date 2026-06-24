import React, {useRef, useState, useCallback} from 'react';
import {View, StyleSheet, BackHandler, Platform} from 'react-native';
import {WebView as RNWebView} from 'react-native-webview';
import type {WebViewProps, WebViewNavigation} from 'react-native-webview';
import {Appbar, ActivityIndicator, Text, Button} from 'react-native-paper';
import {useFocusEffect} from '@react-navigation/native';
import type {StackScreenProps} from '@react-navigation/stack';

import type {RootStackParamList} from '../navigation/AppNavigator';
import {getActiveBaseUrl} from '../services/firmwareApi';
import {releaseForcedWifi} from '../services/wifiManager';

// react-native-webview ships its class typed as `WebView<P = undefined>`, which
// makes its props collapse to `never` under React 19's stricter JSX checking.
// Re-type it (props only) so JSX type-checks; the runtime value and instance
// methods (goBack/reload) are unchanged.
const WebView = RNWebView as unknown as React.ForwardRefExoticComponent<
  WebViewProps & React.RefAttributes<RNWebView>
>;

type Props = StackScreenProps<RootStackParamList, 'WebUi'>;

export default function WebUiScreen({navigation}: Props) {
  const webRef = useRef<RNWebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const canGoBackRef = useRef(false);

  const leaveToSetup = useCallback(() => {
    // Hand the phone's network routing back to the OS before returning.
    releaseForcedWifi().catch(() => {});
    navigation.navigate('Setup');
  }, [navigation]);

  // Android hardware back: navigate within the firmware UI first, otherwise
  // return to the setup screen.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }
      const onBack = () => {
        if (canGoBackRef.current) {
          webRef.current?.goBack();
          return true;
        }
        leaveToSetup();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [leaveToSetup]),
  );

  const onNavStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

  const reload = useCallback(() => {
    setFailed(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  return (
    <View style={styles.flex}>
      <Appbar.Header>
        <Appbar.BackAction onPress={leaveToSetup} />
        <Appbar.Content title="FJ OCS Converter" />
        <Appbar.Action icon="refresh" onPress={reload} />
        <Appbar.Action
          icon="cog"
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate('Settings')}
        />
      </Appbar.Header>

      <View style={styles.flex}>
        {failed ? (
          <View style={styles.center}>
            <Text variant="titleMedium" style={styles.errorTitle}>
              Couldn’t load the control panel
            </Text>
            <Text variant="bodyMedium" style={styles.errorBody}>
              Make sure you’re still connected to the converter’s WiFi
              (FJ-OCS-Config), then try again.
            </Text>
            <Button mode="contained" onPress={reload} style={styles.retry}>
              Retry
            </Button>
            <Button onPress={leaveToSetup}>Back to setup</Button>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{uri: getActiveBaseUrl()}}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onNavigationStateChange={onNavStateChange}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            onHttpError={() => {
              setLoading(false);
              setFailed(true);
            }}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['http://*', 'https://*']}
            mixedContentMode="always"
            startInLoadingState={false}
          />
        )}

        {loading && !failed ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator animating size="large" />
          </View>
        ) : null}
      </View>
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
  errorTitle: {marginBottom: 8, textAlign: 'center'},
  errorBody: {marginBottom: 20, textAlign: 'center', opacity: 0.8},
  retry: {marginBottom: 8},
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
