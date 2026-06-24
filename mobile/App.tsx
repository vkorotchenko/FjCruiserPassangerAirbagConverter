/**
 * FJ OCS Setup — root component.
 *
 * Wires up the providers (gesture handler, safe area, react-native-paper,
 * navigation) around the two-screen flow: WiFi setup -> embedded web UI.
 */
import React from 'react';
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

function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';
  const theme = isDark ? MD3DarkTheme : MD3LightTheme;

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
