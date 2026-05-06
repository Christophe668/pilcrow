import { useState } from "react";
import { TextInput, View } from "react-native";
import { ArticleList } from "@/components/ArticleList";
import { LibraryHeader } from "@/components/LibraryHeader";
import { useSearchArticles } from "@/hooks/useSearchArticles";
import { useSyncNow } from "@/hooks/useSyncNow";

export default function SearchRoute() {
  const [query, setQuery] = useState("");
  const search = useSearchArticles(query);
  const sync = useSyncNow();
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await sync.mutateAsync();
    } finally {
      setPulling(false);
    }
  };
  return (
    <View className="flex-1">
      <LibraryHeader
        title="Search"
        activeFilter="search"
        {...(search.data ? { count: search.data.length } : {})}
      />
      <View className="px-6 py-3 border-b border-border">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search title, body, URL..."
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          className="border border-border bg-surface text-fg rounded-md px-3 py-2"
        />
      </View>
      <ArticleList
        articles={search.data ?? []}
        loading={search.isLoading && query.trim().length > 0}
        refreshing={pulling}
        onRefresh={onRefresh}
        emptyTitle={query.trim().length === 0 ? "Search your library" : "No matches"}
        emptyDescription={
          query.trim().length === 0
            ? "Type above to search article titles, content, and URLs."
            : "Try a shorter or simpler query."
        }
      />
    </View>
  );
}
