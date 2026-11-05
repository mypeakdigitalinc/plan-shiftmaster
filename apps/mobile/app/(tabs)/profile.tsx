import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Badge, Button, Card, ErrorText, Row, Screen, SectionTitle, styles, TextField, ToggleRow } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const ROLE = { employee: 'Employee', manager: 'Manager', org_admin: 'Org admin' } as const;

export default function Profile() {
  const { me, signOut } = useSession();
  const router = useRouter();
  const [name, setName] = useState(me?.profile.name ?? '');
  const [phone, setPhone] = useState(me?.profile.phone ?? '');
  useEffect(() => {
    setName(me?.profile.name ?? '');
    setPhone(me?.profile.phone ?? '');
  }, [me?.profile.name, me?.profile.phone]);

  const save = useApiMutation(() => api.me.update({ name: name.trim(), phone: phone.trim() || null }), [keys.me]);
  const share = useApiMutation((v: boolean) => api.me.update({ shareSchedule: v }), [keys.me, keys.shifts]);
  if (!me?.organization) return null;
  const p = me.profile;
  const dirty = name.trim() !== p.name || (phone.trim() || null) !== p.phone;

  return (
    <Screen>
      <Card>
        <Text style={styles.title}>{p.name}</Text>
        <Text style={styles.muted}>{p.email}</Text>
        <Row label="Organization" value={me.organization.name} />
        <Row label="Role" value={<Badge label={ROLE[p.role]} tone="blue" />} />
        <Row label="Position" value={p.position ?? '—'} />
      </Card>

      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <ToggleRow
          label="Share my schedule with coworkers"
          description="When on, coworkers can see your published shifts. Managers always can."
          value={p.shareSchedule}
          onChange={(v) => share.mutate(v)}
          disabled={share.isPending}
        />
        <ErrorText error={share.error} />
      </Card>

      <SectionTitle>Availability</SectionTitle>
      <Button title="Times I can't work" variant="secondary" onPress={() => router.push('/availability')} />

      <SectionTitle>Contact details</SectionTitle>
      <Card>
        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <ErrorText error={save.error} />
        <Button title={save.isPending ? 'Saving…' : 'Save'} onPress={() => save.mutate(undefined)} disabled={!dirty || !name.trim()} />
      </Card>

      <Button title="Sign out" variant="danger" onPress={signOut} />
    </Screen>
  );
}
