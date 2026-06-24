/**
 * FJ OCS Setup — root component.
 *
 * Wires up the providers (gesture handler, safe area, react-native-paper,
 * navigation) around the two-screen flow: WiFi setup -> embedded web UI.
 * Also runs the app self-update check on launch.
 */
import React, {useEffect} from 'react';
import {StatusBar, useColorScheme, StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {
  PaperProvider,
  MD3DarkTheme,
  MD3LightTheme,
} from 'react-native-paper';
import {NavigationContainer} from '@react-navigation/native';

import AppNavigator from './src/navigation/AppNavigator';
import {useAppStore} from './src/store/useAppStore';
import {
  initAppVersion,
  getCachedAppVersion,
  getCachedAppBuildNumber,
} from './src/services/appVersion';
import {checkForMobileUpdate} from './src/services/mobileUpdateController';
import {cleanupOldApks} from './src/services/mobileAppDownload';

function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const theme = isDark ? MD3DarkTheme : MD3LightTheme;

  // Read the running app's version once at boot and stash it in the store so
  // the update UI can compare against the latest GitHub release.
  useEffect(() => {
    initAppVersion().then(() => {
      const v = getCachedAppVersion();
      const b = getCachedAppBuildNumber();
      if (v && b) {
        useAppStore.getState().setAppVersion(v, b);
      }
    });
  }, []);

  // Fire-and-forget self-update check on mount (1-hour TTL inside the service
  // prevents thrashing). Errors land in the store, never bubble.
  useEffect(() => {
    checkForMobileUpdate().catch(() => {});
  }, []);

  // Sweep any stale downloaded APKs left over from prior update attempts.
  useEffect(() => {
    cleanupOldApks(null).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <NavigationContainer>
            <AppNavigator />
          </NavigationContainer>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
});

export default App;
