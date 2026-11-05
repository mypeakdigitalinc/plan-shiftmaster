import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Button, Card, ErrorText, Screen, styles, TextField } from '@/components/ui';
import { AUTH_MODE, getAuth } from '@/lib/api';
import { colors, space } from '@/lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (AUTH_MODE === 'dev') await getAuth().signInWithPassword(email.trim(), '');
      else if (password) await getAuth().signInWithPassword(email.trim(), password);
      else {
        await getAuth().sendMagicLink(email.trim());
        setLinkSent(true);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ marginTop: 64, marginBottom: space.lg, alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { color: colors.brand, fontSize: 32 }]}>ShiftHub</Text>
          <Text style={styles.muted}>Your schedule, shift trades and swaps.</Text>
        </View>
        <Card>
          {linkSent ? (
            <>
              <Text style={styles.rowValue}>Check your email</Text>
              <Text style={styles.muted}>We sent a sign-in link to {email}.</Text>
              <Button title="Use a different email" variant="secondary" onPress={() => setLinkSent(false)} />
            </>
          ) : (
            <>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                onSubmitEditing={submit}
              />
              {AUTH_MODE === 'supabase' && (
                <TextField
                  label="Password"
                  hint="Leave empty to get a sign-in link by email."
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
              )}
              <ErrorText error={error} />
              <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={!email.includes('@')} loading={busy} />
              {AUTH_MODE === 'dev' && (
                <Text style={[styles.hint, { backgroundColor: colors.warnBg, color: colors.warn, padding: 8, borderRadius: 8 }]}>
                  Dev login: any email, no password. Try staff1@maplegrove.test or owl2@nightowls.test.
                </Text>
              )}
            </>
          )}
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
