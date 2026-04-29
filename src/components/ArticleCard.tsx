import { Image, Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { formatRelative } from "@/lib/time";

export type ArticleCardProps = {
  id: number;
  title: string | null;
  url: string;
  domain: string | null;
  readingTime: number | null;
  isStarred: boolean;
  isArchived: boolean;
  /** 0..1 reading depth. Drives the in-progress percent indicator and the
   * left-edge progress rule on cards that are partway through. */
  scrollPosition?: number;
  updatedAt: string | null;
  previewImage: string | null;
  tags: { id: number; label: string; slug: string }[];
  excerpt?: string | null;
  /** When the host route already filters to a single state, suppress the
   * matching indicator so we don't decorate every row with the same cue.
   * E.g. on the Unread bucket, every card is unread — no need to show the
   * dot. Routes with mixed states (All, Starred, Tag, Search) leave this
   * unset and the card shows its full state cue. */
  suppressIndicatorFor?: ReadState;
};

export type ReadState = "unread" | "in-progress" | "read";

const IN_PROGRESS_LOW = 0.05;
const IN_PROGRESS_HIGH = 0.95;

function readState(isArchived: boolean, scroll: number | undefined): ReadState {
  if (isArchived) return "read";
  if (scroll !== undefined && scroll > IN_PROGRESS_LOW && scroll < IN_PROGRESS_HIGH) {
    return "in-progress";
  }
  return "unread";
}

/**
 * Compute the "X min left" string for an in-progress card. Falls back to
 * "<1 min left" when there's less than a minute, and to a percent if we
 * don't know the article's reading time.
 */
function timeLeftPhrase(readingTime: number | null, scroll: number | undefined): string | null {
  if (scroll === undefined) return null;
  if (readingTime != null && readingTime > 0) {
    const remaining = readingTime * (1 - scroll);
    if (remaining < 1) return "<1 min left";
    return `${Math.ceil(remaining)} min left`;
  }
  // Reading time unknown — fall back to depth percentage.
  const pct = Math.max(5, Math.min(95, Math.round(scroll * 100)));
  return `${pct}% read`;
}

function htmlToExcerpt(html: string | null | undefined): string | null {
  if (!html) return null;
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length === 0) return null;
  if (stripped.length <= 180) return stripped;
  return stripped.slice(0, 180).trimEnd() + "…";
}

function glyphFor(title: string | null, domain: string | null, url: string): string {
  const source = (title ?? domain ?? url ?? "").trim();
  const ch = source.charAt(0);
  if (!ch) return "•";
  return ch.toUpperCase();
}

/**
 * Editorial card: thumbnail, then a column with the title in display
 * serif (headline-first), an excerpt of the body, then a single meta line
 * acting as a citation byline — domain · reading time · saved Xd ago.
 *
 * Read state is signalled in two coordinated ways:
 *  - A 2px column rule on the card's left edge whose fill height equals
 *    `scrollPosition`. Empty for unread, partially filled for in-progress,
 *    absent for read. Echoes the column-rule progress used inside the
 *    article reader — same metaphor at two scales.
 *  - In the meta line, in-progress cards add "X min left" (actionable),
 *    read cards add "✓ read" plus a muted title; unread cards add nothing.
 *
 * `suppressIndicatorFor` lets the host route hide cues that match the
 * route's own filter (e.g. on Unread, the rule is hidden because every
 * card already is unread).
 */
export function ArticleCard(props: ArticleCardProps) {
  const router = useRouter();

  const openArticle = () => {
    router.push(`/(app)/article/${props.id}` as Href);
  };

  const state = readState(props.isArchived, props.scrollPosition);
  const suppressedHere = state === props.suppressIndicatorFor;
  const baseMeta = [
    props.domain,
    props.readingTime ? `${props.readingTime} min` : null,
    formatRelative(props.updatedAt) ? `saved ${formatRelative(props.updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const excerpt = htmlToExcerpt(props.excerpt);
  const visibleTags = props.tags.slice(0, 4);
  const titleClass =
    state === "read"
      ? "font-display text-muted leading-tight tracking-tight mb-1"
      : "font-display text-fg leading-tight tracking-tight mb-1";
  const excerptClass =
    state === "read"
      ? "text-subtle text-sm leading-snug mb-2"
      : "text-muted text-sm leading-snug mb-2";

  // Column-rule fill: proportional to scroll for in-progress.
  const fillPercent =
    state === "in-progress" && typeof props.scrollPosition === "number"
      ? Math.max(0, Math.min(1, props.scrollPosition)) * 100
      : 0;

  // Show the rule with depth info whenever it adds info per card.
  //  - In-progress: ALWAYS show (depth varies per card — even on the
  //    In-progress route where every card is in progress, the *amount*
  //    is the useful signal).
  //  - Unread: show the empty rule on mixed routes (so you can see "this
  //    one's untouched"), but hide on the Unread route where the empty
  //    rule on every card is just decoration.
  //  - Read: never show — read articles get pure typographic recession.
  const showRule = state === "in-progress" || (state === "unread" && !suppressedHere);

  // Time-left text appears on every in-progress card. The phrase varies
  // per card ("3 min left" vs "14 min left"), so it's useful on the
  // In-progress route too.
  const timeLeft =
    state === "in-progress" ? timeLeftPhrase(props.readingTime, props.scrollPosition) : null;
  const showReadSuffix = state === "read" && !suppressedHere;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`open ${props.title ?? props.url}`}
      onPress={openArticle}
      className="border-b border-border active:bg-surface-2 flex-row gap-4 items-start relative"
      // Slightly extra left padding to make room for the column rule
      // sitting in the gutter without pushing into the thumbnail.
      style={{ paddingLeft: 28, paddingRight: 24, paddingVertical: 20 }}
    >
      {showRule ? (
        <View
          accessibilityLabel={state === "in-progress" ? "in progress" : "unread"}
          pointerEvents="none"
          className="absolute"
          style={{
            left: 14,
            top: 16,
            bottom: 16,
            width: 2,
            backgroundColor: "rgba(0,0,0,0)", // base rule is just border colour
            borderRadius: 1,
          }}
        >
          {/* Base rule (full height, faint) */}
          <View
            className="bg-border-strong"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              borderRadius: 1,
              opacity: 0.6,
            }}
          />
          {/* Accent fill, anchored to the top so it grows downward */}
          <View
            className="bg-accent"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: `${fillPercent}%`,
              borderRadius: 1,
            }}
          />
        </View>
      ) : null}

      <View className="w-16 h-16 rounded-md border border-border bg-accent-soft items-center justify-center overflow-hidden">
        {props.previewImage ? (
          <Image
            source={{ uri: props.previewImage }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text className="font-display text-accent-ink text-3xl font-semibold">
            {glyphFor(props.title, props.domain, props.url)}
          </Text>
        )}
      </View>

      <View className="flex-1 min-w-0">
        <Text numberOfLines={2} className={titleClass} style={{ fontSize: 19, fontWeight: "600" }}>
          {props.title ?? props.url}
        </Text>
        {excerpt ? (
          <Text numberOfLines={2} className={excerptClass}>
            {excerpt}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap items-center mt-1">
          {baseMeta.length > 0 ? <Text className="text-subtle text-xs">{baseMeta}</Text> : null}
          {showReadSuffix ? (
            <Text className="text-subtle text-xs italic">
              {baseMeta.length > 0 ? "  ·  " : ""}✓ read
            </Text>
          ) : null}
          {timeLeft !== null ? (
            <Text className="text-accent-ink text-xs italic">
              {baseMeta.length > 0 ? "  ·  " : ""}
              {timeLeft}
            </Text>
          ) : null}
          {visibleTags.length > 0 ? (
            <Text className="text-subtle text-xs">
              {baseMeta.length > 0 || showReadSuffix || timeLeft !== null ? "  ·  " : ""}
              {visibleTags.map((t, i) => (
                <Text key={t.id} className="text-accent-ink italic">
                  {i > 0 ? "  " : ""}#{t.label}
                </Text>
              ))}
            </Text>
          ) : null}
          {props.isStarred ? <Text className="text-accent text-xs ml-2">★</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}
