/**
 * Type scale for UI chrome (not the reader — reader body sizes live in
 * `src/reader/styles.ts` and follow user preference).
 *
 * The scale uses Tailwind's default size ramp; this file documents which
 * role each step plays so component code stays consistent. Reach for the
 * role-based className composition below instead of inventing new sizes.
 *
 * | Role     | Tailwind            | Use for                                      |
 * | -------- | ------------------- | -------------------------------------------- |
 * | display  | text-3xl / 4xl      | Library title, hero card numbers             |
 * | title    | text-xl             | Sheet titles, section heads                  |
 * | body     | text-base / text-sm | Article card body, default UI text           |
 * | label    | text-sm font-medium | Tab labels, button copy                      |
 * | caption  | text-xs             | Meta lines, tag chips, timestamps            |
 * | overline | text-xs uppercase   | All-caps section markers (LibraryHeader cap) |
 *
 * Pair display/title with `font-display` (Newsreader serif). Everything
 * else stays in the system sans stack.
 */
export const typography = {
  display: "font-display leading-tight tracking-tight",
  title: "font-display text-xl leading-snug",
  body: "text-base leading-normal",
  label: "text-sm font-medium",
  caption: "text-xs",
  overline: "text-xs uppercase tracking-widest tabular-nums",
} as const;

export type TypographyRole = keyof typeof typography;

/**
 * Raw numeric scale for non-Tailwind consumers (reader chrome, animated
 * RN styles). Sizes are in px so they can be fed straight into `fontSize`
 * style props without a unit conversion.
 */
export const typeScale = {
  xs: { size: 12, leading: 16 },
  sm: { size: 14, leading: 20 },
  base: { size: 16, leading: 24 },
  lg: { size: 18, leading: 28 },
  xl: { size: 20, leading: 28 },
  "2xl": { size: 24, leading: 32 },
  "3xl": { size: 30, leading: 36 },
  "4xl": { size: 36, leading: 40 },
} as const;
