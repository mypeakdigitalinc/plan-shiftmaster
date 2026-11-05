import { durationHours, type Shift } from "@shifthub/shared";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, space } from "@/lib/theme";
import { Badge } from "./ui";

export function ShiftCard({
  shift,
  areaName,
  positionName,
  showPerson,
}: {
  shift: Shift;
  areaName?: string;
  positionName?: string;
  showPerson?: boolean;
}) {
  const cancelled = shift.status === "cancelled";
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/shift/${shift.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Shift ${shift.startTime} to ${shift.endTime}${areaName ? ` in ${areaName}` : ""}`}
      style={({ pressed }) => [
        s.card,
        cancelled && { opacity: 0.6 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={s.time}>
        <Text style={[s.timeText, cancelled && s.strike]}>
          {shift.startTime}
        </Text>
        <Text style={s.timeSub}>{shift.endTime}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.title, cancelled && s.strike]} numberOfLines={1}>
          {showPerson
            ? (shift.employeeName ?? "Open shift")
            : (positionName ?? "Shift")}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {[
            areaName,
            showPerson ? positionName : null,
            `${durationHours(shift.startTime, shift.endTime)}h`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {cancelled ? (
        <Badge label="Cancelled" tone="red" />
      ) : shift.notes ? (
        <Badge label="Note" tone="blue" />
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
  },
  time: {
    width: 56,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingRight: space.sm,
  },
  timeText: { fontSize: 17, fontWeight: "700", color: colors.text },
  timeSub: { fontSize: 13, color: colors.muted },
  title: { fontSize: 16, fontWeight: "600", color: colors.text },
  sub: { fontSize: 13, color: colors.muted },
  strike: { textDecorationLine: "line-through" },
});
