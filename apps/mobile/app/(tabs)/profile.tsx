import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { pushSupported, registerForPush } from '@/lib/push';
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

      <SectionTitle>Notifications</SectionTitle>
      <PushCard />

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

function PushCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    const r = await registerForPush().catch((e: Error) => ({ ok: false as const, reason: e.message }));
    setStatus(r.ok ? 'Push notifications are on for this phone.' : r.reason);
    setBusy(false);
  };
  return (
    <Card>
      <Text style={styles.muted}>
        {status ??
          (pushSupported
            ? 'Get a buzz for new schedules, swaps, open shifts and reminders 12 hours before each shift.'
            : 'Push notifications work in the phone app. You can still see everything under the bell icon.')}
      </Text>
      {pushSupported && <Button title="Turn on push notifications" variant="secondary" onPress={enable} loading={busy} />}
    </Card>
  );
}
