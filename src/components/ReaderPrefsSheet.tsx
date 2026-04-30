import { Pressable, Text, View } from "react-native";
import { useReaderPrefs } from "@/hooks/useReaderPrefs";
import type { ReaderFontFamily, ReaderFontSize, ReaderTheme } from "@/reader/prefs";

const SIZES: ReaderFontSize[] = ["S", "M", "L", "XL"];
const FAMILIES: ReaderFontFamily[] = ["serif", "sans"];
const THEMES: ReaderTheme[] = ["light", "dark", "sepia"];

export function ReaderPrefsSheet({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = useReaderPrefs();
  return (
    <View className="absolute left-0 right-0 bottom-0 px-6 py-6 border-t border-border bg-surface">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="font-display text-fg text-xl">Reader</Text>
        <Pressable accessibilityRole="button" onPress={onClose} className="px-2 py-1">
          <Text className="text-accent text-sm">Done</Text>
        </Pressable>
      </View>
      <Section label="Size">
        {SIZES.map((s) => (
          <Chip
            key={s}
            label={s}
            active={prefs.fontSize === s}
            onPress={() => setPrefs({ fontSize: s })}
          />
        ))}
      </Section>
      <Section label="Font">
        {FAMILIES.map((f) => (
          <Chip
            key={f}
            label={f === "serif" ? "Serif" : "Sans"}
            active={prefs.fontFamily === f}
            onPress={() => setPrefs({ fontFamily: f })}
          />
        ))}
      </Section>
      <Section label="Theme">
        {THEMES.map((t) => (
          <Chip
            key={t}
            label={t === "light" ? "Light" : t === "dark" ? "Dark" : "Sepia"}
            active={prefs.theme === t}
            onPress={() => setPrefs({ theme: t })}
          />
        ))}
      </Section>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-3">
      <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-2">
        {label}
      </Text>
      <View className="flex-row gap-2">{children}</View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`px-3 py-1.5 rounded-md border ${
        active ? "border-accent bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <Text className={active ? "text-accent-ink text-sm" : "text-fg text-sm"}>{label}</Text>
    </Pressable>
  );
}
