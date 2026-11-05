import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space } from '@/lib/theme';

/** Horizontal single-select chip row. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[s.chip, on && s.on]}
          >
            <Text style={[s.text, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  on: { backgroundColor: colors.brand, borderColor: colors.brand },
  text: { fontSize: 14, fontWeight: '500', color: colors.text },
});
