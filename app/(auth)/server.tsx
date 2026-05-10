import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { normalizeServerUrl } from "@/lib/url";
import { fetchInfo } from "@/api/info";

type Kind = "wallabag" | "readeck";

const Schema = z.object({
  serverUrl: z.string().min(1, "Server URL is required"),
});
type FormData = z.infer<typeof Schema>;

export default function ServerScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("wallabag");
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<FormData>({
    resolver: zodResolver(Schema as never) as Resolver<FormData>,
    defaultValues: { serverUrl: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setSubmitting(true);
    setTopError(null);
    try {
      const url = normalizeServerUrl(data.serverUrl);
      if (kind === "wallabag") {
        // Probe /api/info.json so the user gets a fast "wrong URL"
        // signal before they're asked for a username and password.
        await fetchInfo(url);
        router.push({ pathname: "/(auth)/credentials", params: { serverUrl: url } });
      } else {
        // Readeck has no equivalent unauth probe — defer reachability
        // to the OAuth client-registration step on the next screen.
        router.push({ pathname: "/(auth)/readeck-auth", params: { serverUrl: url } });
      }
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <View className="flex-1 bg-bg items-center justify-center px-6">
      <View className="w-full max-w-[420px]">
        <Text className="font-display text-fg text-4xl mb-2">Pilcrow</Text>
        <Text className="text-muted text-base mb-6">Connect to your read-it-later server</Text>

        <Text className="text-fg text-sm mb-2">Server type</Text>
        <View className="flex-row mb-6 rounded-md overflow-hidden border border-border">
          <KindToggle
            label="Wallabag"
            selected={kind === "wallabag"}
            onPress={() => setKind("wallabag")}
          />
          <KindToggle
            label="Readeck"
            selected={kind === "readeck"}
            onPress={() => setKind("readeck")}
          />
        </View>

        <Text className="text-fg text-sm mb-2">Server URL</Text>
        <Controller
          control={control}
          name="serverUrl"
          render={({ field: { value, onChange, onBlur }, fieldState }) => (
            <View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={
                  kind === "wallabag"
                    ? "Server URL (e.g. https://app.wallabag.it)"
                    : "Server URL (e.g. https://readeck.example.com)"
                }
                placeholderTextColor="#888"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                className="border border-border bg-surface text-fg rounded-md px-3 py-3"
              />
              {fieldState.error ? (
                <Text className="text-accent text-xs mt-1">{fieldState.error.message}</Text>
              ) : null}
            </View>
          )}
        />

        {topError ? <Text className="text-accent text-sm mt-4">{topError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={onSubmit}
          className="bg-accent rounded-md py-3 mt-6 items-center"
        >
          {submitting ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-white font-medium">Continue</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function KindToggle({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`flex-1 py-3 items-center ${selected ? "bg-accent" : "bg-surface"}`}
    >
      <Text className={selected ? "text-white font-medium" : "text-fg"}>{label}</Text>
    </Pressable>
  );
}
