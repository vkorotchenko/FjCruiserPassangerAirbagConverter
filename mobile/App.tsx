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
import {
  NavigationContainer,
  DefaultTheme as NavigationDefaultTheme,
  DarkTheme as NavigationDarkTheme,
} from '@react-navigation/native';

import AppNavigator from './src/navigation/AppNavigator';
import {useAppStore} from './src/store/useAppStore';
import {
  initAppVersion,
  getCachedAppVersion,
  getCachedAppBuildNumber,
} from './src/services/appVersion';
import {cleanupOldFirmware} from './src/services/firmwareDownload';

function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const theme = isDark ? MD3DarkTheme : MD3LightTheme;

  // Derive the React Navigation theme from the active Paper theme so the screen
  // background, surfaces, and text all follow the same light/dark scheme.
  // Without this, NavigationContainer keeps its default light background while
  // Paper renders dark components, leaving unreadable light-on-light text.
  const navTheme = isDark ? NavigationDarkTheme : NavigationDefaultTheme;
  const navigationTheme = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.elevation.level2,
      text: theme.colors.onSurface,
      border: theme.colors.outlineVariant,
      notification: theme.colors.error,
    },
  };

  // Read the running app's version once at boot (shown as info in Settings).
  useEffect(() => {
    initAppVersion().then(() => {
      const v = getCachedAppVersion();
      const b = getCachedAppBuildNumber();
      if (v && b) {
        useAppStore.getState().setAppVersion(v, b);
      }
    });
  }, []);

  // Sweep any stale downloaded firmware images from prior update attempts.
  useEffect(() => {
    cleanupOldFirmware(null).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <NavigationContainer theme={navigationTheme}>
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
