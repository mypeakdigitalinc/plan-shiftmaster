import type { Shift } from '@shifthub/shared';
import { Text } from 'react-native';
import { styles } from '@/components/ui';
import { useNames } from '@/lib/hooks';
import { shortDate } from '@/lib/labels';
import { colors } from '@/lib/theme';

/** "Thu, Nov 12 · 07:00–15:00" + "Birch Unit · Charge Nurse" */
export function ShiftLine({ shift, who }: { shift: Shift | null; who?: string | null }) {
  const names = useNames();
  if (!shift) return <Text style={styles.muted}>Shift no longer visible</Text>;
  const where = [names.areas.get(shift.areaId), shift.assignmentId ? names.positions.get(shift.assignmentId) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
        {shortDate(shift.date)} · {shift.startTime}–{shift.endTime}
      </Text>
      <Text style={styles.muted}>{[who, where].filter(Boolean).join(' · ')}</Text>
    </>
  );
}
