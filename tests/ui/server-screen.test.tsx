import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../src/test/msw-server";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("expo-router", () => ({
  useRouter: () => router,
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ServerScreen from "../../app/(auth)/server";

describe("Server URL screen", () => {
  it("validates with /api/info.json and navigates to credentials", async () => {
    server.use(
      http.get("https://wb.test/api/info.json", () =>
        HttpResponse.json({ appname: "wallabag", version: "2.6.9" }),
      ),
    );
    render(<ServerScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/server url/i), "wb.test");
    fireEvent.press(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/(auth)/credentials",
        params: { serverUrl: "https://wb.test" },
      }),
    );
  });

  it("shows an error when the host is not wallabag", async () => {
    server.use(
      http.get("https://nope.test/api/info.json", () =>
        HttpResponse.json({ appname: "other", version: "1.0" }),
      ),
    );
    render(<ServerScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(/server url/i), "nope.test");
    fireEvent.press(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(screen.getByText(/not a wallabag/i)).toBeTruthy());
  });
});
