import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';

export default function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false });
  const status = health.isPending ? 'checking…' : health.data?.ok ? 'connected' : 'unreachable';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ShiftHub</Text>
      <Text style={styles.subtitle}>Your schedule, shift trades and swaps.</Text>
      <Text style={styles.status}>API: {status}</Text>
      <Text style={styles.note}>Login and My Schedule arrive in phase M1.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 8 },
  title: { fontSize: 32, fontWeight: '600', color: '#0f766e' },
  subtitle: { fontSize: 16, color: '#475569' },
  status: { marginTop: 16, fontSize: 14 },
  note: { fontSize: 13, color: '#64748b' },
});
