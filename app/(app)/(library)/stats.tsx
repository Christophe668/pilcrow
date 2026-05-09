import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { useStats, type Stats } from "@/hooks/useStats";
import { useTokens } from "@/theme/provider";

/**
 * Stats page — editorial / "annual review" aesthetic.
 *
 * The visual language is borrowed from broadsheet layout: a masthead
 * with hairline rules, oversized italic Newsreader numerals as a lede,
 * small-caps mono labels, leader-dotted top-N lists, and a single-color
 * column chart. No cards, no rounded chrome — structure comes from
 * whitespace and rules.
 */

const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_TICK = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const SERIF: { fontFamily: string } = { fontFamily: "Newsreader" };
const SERIF_ITALIC: { fontFamily: string; fontStyle: "italic" } = {
  fontFamily: "Newsreader-Italic",
  fontStyle: "italic",
};

function todayLong(): string {
  const d = new Date();
  return `${MONTH_FULL[d.getMonth()]?.toUpperCase() ?? ""} ${d.getFullYear()}`;
}

function issueLine(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = MONTH_FULL[d.getMonth()] ?? "";
  return `${mm} ${dd}, ${yyyy}`;
}

function formatHoursMinutes(min: number): { primary: string; secondary: string } {
  if (min <= 0) return { primary: "0", secondary: "minutes" };
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return { primary: String(m), secondary: m === 1 ? "minute" : "minutes" };
  if (m === 0) return { primary: String(h), secondary: h === 1 ? "hour" : "hours" };
  return { primary: `${h}:${String(m).padStart(2, "0")}`, secondary: "hours" };
}

export default function StatsRoute() {
  const stats = useStats();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center pb-20">
      <View className="w-full max-w-[680px] px-7 pt-14">
        <Masthead />
        {stats.isLoading || !stats.data ? (
          <View className="py-32 items-center">
            <ActivityIndicator />
          </View>
        ) : (
          <StatsBody data={stats.data} />
        )}
      </View>
    </ScrollView>
  );
}

function Masthead() {
  return (
    <View className="mb-10">
      <View className="border-t-2 border-fg" />
      <View className="flex-row justify-between items-center py-2">
        <Text className="font-mono text-fg uppercase" style={{ fontSize: 9, letterSpacing: 2 }}>
          VOL. 01 · YOUR LIBRARY
        </Text>
        <Text className="font-mono text-fg uppercase" style={{ fontSize: 9, letterSpacing: 2 }}>
          {todayLong()}
        </Text>
      </View>
      <View className="border-t border-fg" />

      <View className="items-center mt-7 mb-3">
        <Text
          className="text-fg text-center"
          style={[SERIF, { fontSize: 44, lineHeight: 46, letterSpacing: -1 }]}
        >
          The Pilcrow
        </Text>
        <Text
          className="text-fg text-center -mt-1"
          style={[SERIF_ITALIC, { fontSize: 44, lineHeight: 46, letterSpacing: -1 }]}
        >
          Review
        </Text>
      </View>

      <View className="border-t border-fg" />
      <Text className="text-muted text-center py-2" style={[SERIF_ITALIC, { fontSize: 13 }]}>
        A summary of your reading life, compiled from the archive.
      </Text>
      <View className="border-t border-fg" />
    </View>
  );
}

function StatsBody({ data }: { data: Stats }) {
  const { totals, domains, tags, languages, months } = data;
  const readPct = totals.total > 0 ? Math.round((totals.archived / totals.total) * 100) : 0;
  const time = formatHoursMinutes(totals.minutesRead);
  const backlog = formatHoursMinutes(totals.minutesPending);

  return (
    <>
      {/* LEDE — the headline number. */}
      <View className="mb-12 items-center">
        <Kicker>HOURS SPENT IN ATTENTION</Kicker>
        <Text
          className="text-accent text-center"
          style={[SERIF_ITALIC, { fontSize: 128, lineHeight: 130, letterSpacing: -4 }]}
        >
          {time.primary}
        </Text>
        <Text className="text-fg" style={[SERIF_ITALIC, { fontSize: 18 }]}>
          {time.secondary} of close reading
        </Text>
        <Text
          className="text-subtle mt-2 text-center"
          style={[SERIF, { fontSize: 13, lineHeight: 20 }]}
        >
          across <Text style={SERIF_ITALIC}>{totals.archived.toLocaleString()}</Text> finished
          {totals.archived === 1 ? " article" : " articles"}, or roughly{" "}
          <Text style={SERIF_ITALIC}>{readPct}%</Text> of your library.
        </Text>
      </View>

      {/* THREE-COLUMN FIGURE TABLE */}
      <SectionRule label="By the Numbers" />
      <View className="flex-row -mx-3 mb-12">
        <Figure label="Saved" value={totals.total.toLocaleString()} />
        <Divider />
        <Figure label="Unread" value={totals.unread.toLocaleString()} />
        <Divider />
        <Figure label="Starred" value={totals.starred.toLocaleString()} />
      </View>

      {/* ACTIVITY CHART */}
      <SectionRule label="The Year in Saving" subtitle="Last 12 months" />
      <ActivityChart months={months} />
      <ActivityCaption months={months} />

      {/* TOP DOMAINS */}
      {domains.length > 0 ? (
        <>
          <SectionRule label="Most-Read Sources" />
          <LeaderList
            items={domains.map((d) => ({
              key: d.domain,
              label: d.domain,
              value: d.count,
            }))}
          />
        </>
      ) : null}

      {/* TOP TAGS */}
      {tags.length > 0 ? (
        <>
          <SectionRule label="Recurring Subjects" />
          <LeaderList
            items={tags.map((t) => ({
              key: t.slug,
              label: t.label,
              prefix: "#",
              value: t.count,
              href: `/(app)/(library)/tags/${t.slug}` as Href,
            }))}
          />
        </>
      ) : null}

      {/* LANGUAGES + BACKLOG — secondary stats, set as a footer */}
      {languages.length > 0 ? (
        <>
          <SectionRule label="In Translation" />
          <View className="flex-row flex-wrap -mx-2 mb-12">
            {languages.map((l) => (
              <View key={l.language} className="px-2 mb-3">
                <Text className="text-fg" style={[SERIF_ITALIC, { fontSize: 24 }]}>
                  {l.count}
                </Text>
                <Text
                  className="font-mono text-subtle uppercase"
                  style={{ fontSize: 9, letterSpacing: 1.5 }}
                >
                  {l.language}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* COLOPHON — closing block with backlog & highlights */}
      <View className="border-t border-fg pt-4 pb-2">
        <Text className="text-fg" style={[SERIF_ITALIC, { fontSize: 14, lineHeight: 22 }]}>
          A backlog of{" "}
          <Text className="text-accent">
            {backlog.primary} {backlog.secondary}
          </Text>{" "}
          awaits; <Text className="text-accent">{totals.annotations.toLocaleString()}</Text>{" "}
          {totals.annotations === 1 ? "highlight has" : "highlights have"} been collected.
        </Text>
      </View>

      <View className="border-t-2 border-fg mt-2" />
      <Text className="text-muted text-center mt-3" style={[SERIF_ITALIC, { fontSize: 11 }]}>
        Compiled {issueLine()}.
      </Text>
    </>
  );
}

function Kicker({ children }: { children: string }) {
  return (
    <Text
      className="font-mono text-subtle uppercase mb-2"
      style={{ fontSize: 9, letterSpacing: 2 }}
    >
      {children}
    </Text>
  );
}

function SectionRule({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <View className="mb-4">
      <View className="border-t border-fg" />
      <View className="flex-row items-baseline justify-between py-1.5">
        <Text className="text-fg" style={[SERIF, { fontSize: 13, letterSpacing: 0.3 }]}>
          {label}
        </Text>
        {subtitle ? (
          <Text
            className="font-mono text-subtle uppercase"
            style={{ fontSize: 9, letterSpacing: 1.5 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="border-t border-border" />
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center px-3">
      <Text
        className="text-fg"
        style={[SERIF_ITALIC, { fontSize: 44, lineHeight: 46, letterSpacing: -1 }]}
      >
        {value}
      </Text>
      <Text
        className="font-mono text-subtle uppercase mt-1"
        style={{ fontSize: 9, letterSpacing: 2 }}
      >
        {label}
      </Text>
    </View>
  );
}

function Divider() {
  return <View className="border-l border-border" />;
}

/**
 * Twin-bar column chart, single spot color. "Saved" is the dominant
 * accent column; "Read" is a slightly inset, dimmed column rendered
 * in foreground ink. Numerals on the y-axis are italic serif so they
 * read like footnotes rather than UI chrome.
 *
 * Hover (web) or press (touch) on a column reveals that month's values
 * typeset above the bars in italic serif — same compositional language
 * as the persistent peak annotation. While interacting, the peak
 * annotation hides so labels never overlap.
 */
function ActivityChart({ months }: { months: Stats["months"] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.saved, m.read)));
  const peakIdx = months.reduce(
    (best, m, i) => (m.saved > (months[best]?.saved ?? 0) ? i : best),
    0,
  );
  const [active, setActive] = useState<number | null>(null);

  return (
    <View className="mb-3">
      <View className="flex-row items-end h-40 gap-1.5">
        {/* y-axis label */}
        <View className="w-6 h-full justify-between items-end pr-1.5">
          <Text className="text-subtle" style={[SERIF_ITALIC, { fontSize: 11 }]}>
            {max}
          </Text>
          <Text className="text-subtle" style={[SERIF_ITALIC, { fontSize: 11 }]}>
            0
          </Text>
        </View>
        {/* bars */}
        <View className="flex-1 flex-row items-end gap-[3px] h-full border-l border-border pl-2">
          {months.map((m, i) => {
            const savedH = (m.saved / max) * 100;
            const readH = (m.read / max) * 100;
            const isActive = active === i;
            const showPeak = active === null && i === peakIdx && m.saved > 0;
            return (
              <Pressable
                key={m.month}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((cur) => (cur === i ? null : cur))}
                onPressIn={() => setActive(i)}
                onPressOut={() => setActive((cur) => (cur === i ? null : cur))}
                accessibilityRole="button"
                accessibilityLabel={`${MONTH_TICK[Number(m.month.split("-")[1]) - 1] ?? ""} ${m.month.slice(0, 4)}: ${m.saved} saved, ${m.read} read`}
                className="flex-1 h-full justify-end"
              >
                <View className="flex-row items-end gap-[1px] h-full">
                  <View className="flex-1 h-full justify-end">
                    <View
                      className={isActive ? "bg-accent-ink w-full" : "bg-accent w-full"}
                      style={{ height: `${Math.max(savedH, m.saved > 0 ? 2 : 0)}%` }}
                    />
                  </View>
                  <View className="flex-1 h-full justify-end">
                    <View
                      className="bg-fg w-full"
                      style={{
                        height: `${Math.max(readH, m.read > 0 ? 2 : 0)}%`,
                        opacity: isActive ? 1 : 0.6,
                      }}
                    />
                  </View>
                </View>
                {isActive ? (
                  <View
                    className="absolute left-0 right-0 items-center"
                    style={{ top: -28, minWidth: 56, marginLeft: -16, marginRight: -16 }}
                    pointerEvents="none"
                  >
                    <Text
                      className="text-accent"
                      style={[SERIF_ITALIC, { fontSize: 13, lineHeight: 14 }]}
                    >
                      {m.saved}
                    </Text>
                    <Text
                      className="text-fg"
                      style={[SERIF_ITALIC, { fontSize: 11, lineHeight: 12, opacity: 0.7 }]}
                    >
                      {m.read}
                    </Text>
                  </View>
                ) : showPeak ? (
                  <Text
                    className="text-accent absolute -top-4 left-0 right-0 text-center"
                    style={[SERIF_ITALIC, { fontSize: 11 }]}
                    pointerEvents="none"
                  >
                    {m.saved}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* tick row */}
      <View className="flex-row mt-1.5">
        <View className="w-6" />
        <View className="flex-1 flex-row pl-2">
          {months.map((m, i) => {
            const idx = Number(m.month.split("-")[1]) - 1;
            const isActive = active === i;
            return (
              <View key={m.month} className="flex-1 items-center">
                <Text
                  className={isActive ? "font-mono text-accent" : "font-mono text-subtle"}
                  style={{ fontSize: 9, letterSpacing: 1 }}
                >
                  {MONTH_TICK[idx] ?? ""}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function ActivityCaption({ months }: { months: Stats["months"] }) {
  const totalSaved = months.reduce((s, m) => s + m.saved, 0);
  const totalRead = months.reduce((s, m) => s + m.read, 0);
  return (
    <View className="flex-row items-center mb-12 mt-1">
      <View className="flex-row items-center mr-5">
        <View className="w-2.5 h-2.5 bg-accent mr-1.5" />
        <Text
          className="font-mono text-subtle uppercase"
          style={{ fontSize: 9, letterSpacing: 1.5 }}
        >
          SAVED
        </Text>
        <Text className="text-fg ml-1.5" style={[SERIF_ITALIC, { fontSize: 12 }]}>
          {totalSaved}
        </Text>
      </View>
      <View className="flex-row items-center">
        <View className="w-2.5 h-2.5 bg-fg opacity-60 mr-1.5" />
        <Text
          className="font-mono text-subtle uppercase"
          style={{ fontSize: 9, letterSpacing: 1.5 }}
        >
          READ
        </Text>
        <Text className="text-fg ml-1.5" style={[SERIF_ITALIC, { fontSize: 12 }]}>
          {totalRead}
        </Text>
      </View>
    </View>
  );
}

type LeaderItem = {
  key: string;
  label: string;
  prefix?: string;
  value: number;
  href?: Href;
};

/**
 * TOC-style leader-dotted list. Label on the left, dotted leader filling
 * the middle, italic serif numeral on the right. The classic newspaper
 * "page X" look.
 */
function LeaderList({ items }: { items: LeaderItem[] }) {
  return (
    <View className="mb-12">
      {items.map((item, idx) => (
        <LeaderRow key={item.key} item={item} index={idx + 1} />
      ))}
    </View>
  );
}

function LeaderRow({ item, index }: { item: LeaderItem; index: number }) {
  const tokens = useTokens();
  const inner = (
    <View className="flex-row items-baseline py-2">
      <Text className="text-subtle mr-2" style={[SERIF_ITALIC, { fontSize: 11, width: 18 }]}>
        {String(index).padStart(2, "0")}
      </Text>
      <Text className="text-fg" numberOfLines={1} style={[SERIF, { fontSize: 16 }]}>
        {item.prefix ? <Text style={{ color: tokens.accent }}>{item.prefix}</Text> : null}
        {item.label}
      </Text>
      <View
        className="flex-1 mx-2 self-end mb-1.5"
        style={{
          borderBottomWidth: 1,
          borderStyle: "dotted",
          borderColor: tokens["border-strong"],
        }}
      />
      <Text
        className="text-fg"
        style={[SERIF_ITALIC, { fontSize: 18, minWidth: 28, textAlign: "right" }]}
      >
        {item.value}
      </Text>
    </View>
  );

  if (item.href) {
    return (
      <Link href={item.href} asChild>
        <Pressable accessibilityRole="link">{inner}</Pressable>
      </Link>
    );
  }
  return inner;
}
