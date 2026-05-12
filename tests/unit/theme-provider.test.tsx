import { describe, it, expect } from "vitest";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { ThemeProvider, useTheme, type ThemeMode } from "@/theme/provider";

let captured: { mode: string; resolved: string } | null = null;

function Probe() {
  const { mode, resolved } = useTheme();
  captured = { mode, resolved };
  return <Text testID="probe">{`${mode}:${resolved}`}</Text>;
}

function probe(initialMode: ThemeMode, systemScheme: "light" | "dark") {
  captured = null;
  render(
    <ThemeProvider initialMode={initialMode} systemScheme={systemScheme}>
      <Probe />
    </ThemeProvider>,
  );
  if (!captured) throw new Error("Probe did not render");
  return captured;
}

describe("ThemeProvider", () => {
  it("defaults to auto mode", () => {
    const { mode, resolved } = probe("auto", "light");
    expect(mode).toBe("auto");
    expect(resolved).toBe("light");
  });

  it("explicit dark overrides system light", () => {
    const { mode, resolved } = probe("dark", "light");
    expect(mode).toBe("dark");
    expect(resolved).toBe("dark");
  });

  it("sepia is its own resolved value", () => {
    const { mode, resolved } = probe("sepia", "dark");
    expect(mode).toBe("sepia");
    expect(resolved).toBe("sepia");
  });
});
