import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useForm, Controller, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordGrant, InvalidCredentialsError } from "@/auth/oauth";
import { signIn } from "@/auth/state";

const Schema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
type FormData = z.infer<typeof Schema>;

export default function CredentialsScreen() {
  const router = useRouter();
  const { serverUrl } = useLocalSearchParams<{ serverUrl: string }>();
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit } = useForm<FormData>({
    resolver: zodResolver(Schema as never) as never,
    defaultValues: { clientId: "", clientSecret: "", username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (!serverUrl) {
      setTopError("Missing server URL — restart onboarding");
      return;
    }
    setSubmitting(true);
    setTopError(null);
    try {
      const bundle = await passwordGrant({
        serverUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        password: data.password,
      });
      await signIn({
        serverUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        username: data.username,
        bundle,
      });
      router.replace("/(app)/(library)");
    } catch (e) {
      if (e instanceof InvalidCredentialsError) setTopError("Invalid credentials");
      else setTopError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <View className="flex-1 bg-bg px-6 justify-center">
      <Text className="font-display text-fg text-3xl mb-1">Connect</Text>
      <Text className="text-muted text-sm mb-6">{hostOf(serverUrl)}</Text>

      <Pressable
        onPress={() =>
          serverUrl ? Linking.openURL(`${serverUrl}/developer/client/create`) : undefined
        }
      >
        <Text className="text-accent text-sm mb-6">Need a client_id and secret?</Text>
      </Pressable>

      <Field control={control} name="clientId" placeholder="Client ID" />
      <Field control={control} name="clientSecret" placeholder="Client Secret" secure />
      <Field control={control} name="username" placeholder="Username" />
      <Field control={control} name="password" placeholder="Password" secure />

      {topError ? <Text className="text-accent text-sm mt-3">{topError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={onSubmit}
        className="bg-accent rounded-md py-3 mt-6 items-center"
      >
        {submitting ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-white font-medium">Sign in</Text>
        )}
      </Pressable>
    </View>
  );
}

function hostOf(u: string | undefined): string {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

function Field({
  control,
  name,
  placeholder,
  secure,
}: {
  control: Control<FormData>;
  name: keyof FormData;
  placeholder: string;
  secure?: boolean;
}) {
  return (
    <View className="mb-3">
      <Controller
        control={control}
        name={name}
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={placeholder}
            placeholderTextColor="#888"
            secureTextEntry={!!secure}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            className="border border-border bg-surface text-fg rounded-md px-3 py-3"
          />
        )}
      />
    </View>
  );
}
