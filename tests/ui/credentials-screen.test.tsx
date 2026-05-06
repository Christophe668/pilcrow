import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const secure = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));
const asyncMem = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => asyncMem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void asyncMem.set(k, v)),
    removeItem: vi.fn(async (k: string) => void asyncMem.delete(k)),
  },
}));

const router = { push: vi.fn(), replace: vi.fn() };
const params = { serverUrl: "https://wb.test" };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => params,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CredentialsScreen from "../../app/(auth)/credentials";

beforeEach(() => {
  secure.clear();
  asyncMem.clear();
  router.push.mockClear();
  router.replace.mockClear();
});

describe("Credentials screen", () => {
  it("signs in and replaces to (app)", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ),
    );
    render(<CredentialsScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/client id/i), "cid");
    fireEvent.changeText(screen.getByPlaceholderText(/client secret/i), "cs");
    fireEvent.changeText(screen.getByPlaceholderText(/username/i), "u");
    fireEvent.changeText(screen.getByPlaceholderText(/password/i), "p");
    fireEvent.press(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(app)"));
    expect(secure.get("wb_access_token")).toBe("at");
    expect(secure.get("wb_username")).toBe("u");
    expect(secure.has("wb_password")).toBe(false);
  });

  it("surfaces invalid_grant cleanly", async () => {
    server.use(
      http.post("https://wb.test/oauth/v2/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    render(<CredentialsScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/client id/i), "cid");
    fireEvent.changeText(screen.getByPlaceholderText(/client secret/i), "cs");
    fireEvent.changeText(screen.getByPlaceholderText(/username/i), "u");
    fireEvent.changeText(screen.getByPlaceholderText(/password/i), "wrong");
    fireEvent.press(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeTruthy());
  });
});
