import React from 'react';
import {createStackNavigator} from '@react-navigation/stack';

import WifiSetupScreen from '../screens/WifiSetupScreen';
import WebUiScreen from '../screens/WebUiScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  Setup: undefined;
  WebUi: {staIp?: string} | undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Setup"
      screenOptions={{headerShown: false}}>
      <Stack.Screen name="Setup" component={WifiSetupScreen} />
      <Stack.Screen name="WebUi" component={WebUiScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
