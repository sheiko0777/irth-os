export { ErrorBoundary } from "expo-router";
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { setSessionToken, setOrgId } from '../../lib/auth';
import { apiFetch } from '../../lib/api';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const { t } = useTranslation();

  const handleLogin = async () => {
    try {
      // Simulate API call to /api/auth/sign-in
      const response = await apiFetch<{ token: string; orgId: string }>('/api/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      await setSessionToken(response.token);
      await setOrgId(response.orgId);
      
      router.replace('/(tabs)/orders');
    } catch (error) {
      Alert.alert(t('auth.error'), (error as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('auth.login')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
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
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
  },
});
