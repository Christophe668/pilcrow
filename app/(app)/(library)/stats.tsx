import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { useStats, type Stats } from "@/hooks/useStats";
import { useBreakpoint } from "@/hooks/useResponsive";

const MONTH_SHORT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
}

export default function StatsRoute() {
  const stats = useStats();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center pb-16">
      <View className="w-full max-w-[760px] px-6 pt-12">
        <Text className="font-display text-fg text-3xl mb-1">Stats</Text>
        <Text className="text-muted text-sm mb-8">A look at your library.</Text>

        {stats.isLoading || !stats.data ? (
          <View className="py-16 items-center">
            <ActivityIndicator />
          </View>
        ) : (
          <StatsBody data={stats.data} />
        )}
      </View>
    </ScrollView>
  );
}

function StatsBody({ data }: { data: Stats }) {
  const { totals, domains, tags, languages, months } = data;
  const readPct = totals.total > 0 ? Math.round((totals.archived / totals.total) * 100) : 0;
  const breakpoint = useBreakpoint();
  const tileWidth = breakpoint === "phone" ? "w-1/2" : "w-1/3";

  return (
    <>
      <View className="flex-row flex-wrap -mx-1.5 mb-8">
        <Tile width={tileWidth} label="Total" value={totals.total.toLocaleString()} />
        <Tile width={tileWidth} label="Unread" value={totals.unread.toLocaleString()} />
        <Tile
          width={tileWidth}
          label="Read"
          value={`${totals.archived.toLocaleString()} · ${readPct}%`}
        />
        <Tile width={tileWidth} label="Starred" value={totals.starred.toLocaleString()} />
        <Tile width={tileWidth} label="Time read" value={formatMinutes(totals.minutesRead)} />
        <Tile width={tileWidth} label="Backlog" value={formatMinutes(totals.minutesPending)} />
      </View>

      <Section title="Activity" subtitle="Last 12 months">
        <MonthChart months={months} />
        <View className="flex-row gap-4 mt-3 px-4 pb-4">
          <Legend color="bg-accent" label="Saved" />
          <Legend color="bg-teal" label="Read" />
        </View>
      </Section>

      <Section title="Top domains">
        {domains.length === 0 ? (
          <EmptyRow text="No domains yet." />
        ) : (
          <BarList
            items={domains.map((d) => ({ key: d.domain, label: d.domain, value: d.count }))}
          />
        )}
      </Section>

      <Section title="Top tags">
        {tags.length === 0 ? (
          <EmptyRow text="No tags yet." />
        ) : (
          <BarList
            items={tags.map((t) => ({
              key: t.slug,
              label: `#${t.label}`,
              value: t.count,
              href: `/(app)/(library)/tags/${t.slug}` as Href,
            }))}
          />
        )}
      </Section>

      {languages.length > 0 ? (
        <Section title="Languages">
          <BarList
            items={languages.map((l) => ({
              key: l.language,
              label: l.language.toUpperCase(),
              value: l.count,
            }))}
          />
        </Section>
      ) : null}

      <View className="items-center mt-2">
        <Text className="text-subtle text-xs">
          {totals.annotations.toLocaleString()} highlight
          {totals.annotations === 1 ? "" : "s"}
        </Text>
      </View>
    </>
  );
}

function Tile({ width, label, value }: { width: string; label: string; value: string }) {
  return (
    <View className={`${width} px-1.5 mb-3`}>
      <View className="border border-border bg-surface rounded-md px-4 py-3">
        <Text className="font-mono text-subtle uppercase text-[10px] tracking-widest mb-1">
          {label}
        </Text>
        <Text className="text-fg text-xl tabular-nums">{value}</Text>
      </View>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-8">
      <View className="flex-row items-baseline justify-between mb-2 px-1">
        <Text className="font-mono text-subtle uppercase text-xs tracking-widest">{title}</Text>
        {subtitle ? <Text className="text-subtle text-xs">{subtitle}</Text> : null}
      </View>
      <View className="border border-border bg-surface rounded-md overflow-hidden">{children}</View>
    </View>
  );
}

function MonthChart({ months }: { months: Stats["months"] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.saved, m.read)));
  return (
    <View className="px-4 pt-4">
      <View className="flex-row items-end h-32 gap-1.5">
        {months.map((m) => {
          const savedPct = (m.saved / max) * 100;
          const readPct = (m.read / max) * 100;
          const monthIdx = Number(m.month.split("-")[1]) - 1;
          return (
            <View key={m.month} className="flex-1 items-center">
              <View className="w-full flex-1 flex-row items-end gap-0.5">
                <Bar pct={savedPct} color="bg-accent" />
                <Bar pct={readPct} color="bg-teal" />
              </View>
              <Text className="font-mono text-subtle text-[10px] mt-1">
                {MONTH_SHORT[monthIdx] ?? ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  // Keep a 1px nub so empty months still register visually.
  const heightPct = pct > 0 ? Math.max(pct, 2) : 0;
  return (
    <View className="flex-1 justify-end h-full">
      <View
        className={`${color} rounded-sm w-full`}
        style={{ height: `${heightPct}%`, minHeight: pct > 0 ? 2 : 0 }}
      />
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View className={`${color} w-2.5 h-2.5 rounded-sm`} />
      <Text className="text-muted text-xs">{label}</Text>
    </View>
  );
}

type BarItem = { key: string; label: string; value: number; href?: Href };

function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View>
      {items.map((item, idx) => {
        const className = `flex-row items-center px-4 py-2.5 ${
          idx === items.length - 1 ? "" : "border-b border-border"
        }`;
        const inner = (
          <>
            <Text className="text-fg text-sm flex-1" numberOfLines={1}>
              {item.label}
            </Text>
            <View className="w-32 h-1.5 bg-surface-2 rounded-full overflow-hidden ml-3">
              <View
                className="bg-accent h-full"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </View>
            <Text className="text-muted text-sm tabular-nums ml-3 w-10 text-right">
              {item.value}
            </Text>
          </>
        );
        if (item.href) {
          return (
            <Link key={item.key} href={item.href} asChild>
              <Pressable className={className} accessibilityRole="link">
                {inner}
              </Pressable>
            </Link>
          );
        }
        return (
          <View key={item.key} className={className}>
            {inner}
          </View>
        );
      })}
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View className="px-4 py-6">
      <Text className="text-subtle text-sm">{text}</Text>
    </View>
  );
}
