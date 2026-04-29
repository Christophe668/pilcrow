import { useLocalSearchParams, Redirect } from "expo-router";
import type { Href } from "expo-router";
import { serializeTagsParam } from "@/lib/tagParams";

/**
 * Legacy tag-only route. Tags are now an overlay filter rather than their
 * own destination — when someone hits this URL (deep link, bookmark) we
 * redirect them to the All view with the tag pre-selected so the new
 * multi-select UI is the canonical surface.
 */
export default function LegacyTagRedirect() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const slug = (tag ?? "").toString();
  const tagsParam = serializeTagsParam(slug ? [slug] : []);
  const href = tagsParam
    ? (`/(app)/(library)/all?tags=${tagsParam}` as Href)
    : ("/(app)/(library)/all" as Href);
  return <Redirect href={href} />;
}
