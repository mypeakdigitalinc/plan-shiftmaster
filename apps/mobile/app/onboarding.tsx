import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Screen, styles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Join with an invite code, accept an email invitation, or start a worker group. */
export default function Onboarding() {
  const { me, setMe, signOut } = useSession();
  const params = useLocalSearchParams<{ token?: string }>();
  const [code, setCode] = useState('');
  const [token, setToken] = useState(params.token ?? '');
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<Parameters<typeof setMe>[0]>) => async () => {
    setBusy(key);
    setError(null);
    try {
      setMe(await fn());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Text style={styles.muted}>Signed in as {me?.profile.email}</Text>
      <ErrorText error={error} />

      <Card>
        <Text style={styles.rowValue}>Join with a code</Text>
        <Text style={styles.hint}>Ask your manager or group admin for the invite code.</Text>
        <TextField label="Invite code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
        <Button title="Join" onPress={run('code', () => api.onboarding.join(code.trim()))} disabled={code.trim().length < 4} loading={busy === 'code'} />
      </Card>

      <Card>
        <Text style={styles.rowValue}>Have an invitation link?</Text>
        <TextField label="Invitation token" hint="The last part of the link you were sent." value={token} onChangeText={setToken} />
        <Button
          title="Accept invitation"
          variant="secondary"
          onPress={run('token', () => api.onboarding.acceptInvitation(token.trim().split('/').pop() ?? ''))}
          disabled={token.trim().length < 16}
          loading={busy === 'token'}
        />
      </Card>

      <Card>
        <Text style={styles.rowValue}>Start a worker group</Text>
        <Text style={styles.hint}>For coworkers who want to share schedules and trade shifts among themselves.</Text>
        <TextField label="Group name" value={groupName} onChangeText={setGroupName} autoCapitalize="words" />
        <Button
          title="Create group"
          variant="secondary"
          onPress={run('group', () => api.onboarding.createOrganization({ name: groupName.trim(), mode: 'group' }))}
          disabled={groupName.trim().length < 2}
          loading={busy === 'group'}
        />
      </Card>

      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
