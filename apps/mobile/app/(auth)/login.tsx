export { ErrorBoundary } from "expo-router";
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { setSessionToken } from '../../lib/auth';
import { authFetch } from '../../lib/api';

// Local to this screen, not @irth/types — Area C's remit is the orders/products
// drift; better-auth's sign-in response is a separate concern. Fields are
// optional to match the existing defensive `response.token || response.session
// && response.session.token` fallback below: better-auth's shape varies by
// configuration, and tightening this beyond what the code already handles
// would risk rejecting a legitimate response shape we haven't observed.
const AuthResponseSchema = z.object({
  token: z.string().optional(),
  user: z.any().optional(),
  session: z.object({ token: z.string().optional() }).optional(),
  // Set instead of token/session when the account has 2FA enabled (see
  // better-auth's twoFactor plugin, wired in apps/api/src/auth.ts). Its
  // challenge is a signed cookie exchange, which doesn't fit this app's
  // bearer-token client without its own design pass — handled below as an
  // explicit "not supported yet" message, not a silent dead end.
  twoFactorRedirect: z.boolean().optional(),
});

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const { t } = useTranslation();

  const handleLogin = async () => {
    try {
      // API call to better-auth — authFetch, not apiFetch: Better Auth's
      // handler returns its own response shape, not this app's
      // {data,error,meta} REST envelope (see lib/api.ts's authFetch comment).
      const response = await authFetch('/api/auth/sign-in/email', AuthResponseSchema, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (response.twoFactorRedirect) {
        Alert.alert(t('auth.error'), t('auth.twoFactorRequired'));
        return;
      }

      // better-auth might return token inside session or directly
      const token = response.token || (response.session && response.session.token);
      if (!token) {
        // No token and no 2FA redirect: an unrecognized response shape.
        // Previously this fell through to router.replace below regardless,
        // sending the user into the app with no session at all.
        Alert.alert(t('auth.error'));
        return;
      }
      await setSessionToken(token);
      router.replace('/(tabs)/orders');
    } catch (error) {
      Alert.alert(t('auth.error'), (error as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('auth.login')}</Text>
      <TextInput
        style={[styles.input, styles.rtlText]}
        placeholder={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textAlign="right"
      />
      <TextInput
        style={[styles.input, styles.rtlText]}
        placeholder={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textAlign="right"
      />
      <Button title={t('auth.submit')} onPress={handleLogin} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
    fontFamily: 'Cairo',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
  },
  rtlText: {
    textAlign: 'right',
    fontFamily: 'Cairo',
  },
});
