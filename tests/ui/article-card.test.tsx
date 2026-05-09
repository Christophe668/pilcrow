import { render, screen } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { ArticleCard, type ArticleCardProps } from "@/components/ArticleCard";

function renderCard(props: ArticleCardProps) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ArticleCard {...props} />
    </QueryClientProvider>,
  );
}

describe("ArticleCard", () => {
  it("renders title, domain, and tags", () => {
    renderCard({
      id: 1,
      title: "Hello world",
      url: "https://example.com/x",
      domain: "example.com",
      readingTime: 5,
      isStarred: false,
      isArchived: false,
      updatedAt: new Date().toISOString(),
      previewImage: null,
      tags: [{ id: 10, label: "tech", slug: "tech" }],
    });
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText(/example.com/)).toBeTruthy();
    // Tags now render with a leading `#` as an italic section label.
    expect(screen.getByText(/#tech/)).toBeTruthy();
  });

  it("renders the inline star indicator when starred", () => {
    renderCard({
      id: 1,
      title: "Hello",
      url: "https://x",
      domain: "x",
      readingTime: null,
      isStarred: true,
      isArchived: false,
      updatedAt: null,
      previewImage: null,
      tags: [],
    });
    // The card no longer exposes a star toggle; it shows a small ★ glyph in
    // the meta line as an indicator. Action lives in the article reader.
    expect(screen.getByText("★")).toBeTruthy();
  });

  it("renders the excerpt when provided", () => {
    renderCard({
      id: 1,
      title: "Title",
      url: "https://example.com/x",
      domain: "example.com",
      readingTime: 5,
      isStarred: false,
      isArchived: false,
      updatedAt: null,
      previewImage: null,
      tags: [],
      excerpt: "<p>Hello <b>world</b>, this is the body.</p>",
    });
    expect(screen.getByText(/Hello world\s*,? this is the body/)).toBeTruthy();
  });

  it("renders the preview_picture when provided", () => {
    renderCard({
      id: 1,
      title: "x",
      url: "https://example.com/x",
      domain: "example.com",
      readingTime: null,
      isStarred: false,
      isArchived: false,
      updatedAt: null,
      previewImage: "https://example.com/preview.jpg",
      tags: [],
    });
    // The Image component renders as a host element on web; just verify no
    // crash + glyph is absent.
    expect(screen.queryByText("X")).toBeNull();
  });

  it("falls back to URL when title is null", () => {
    renderCard({
      id: 1,
      title: null,
      url: "https://example.com/x",
      domain: "example.com",
      readingTime: null,
      isStarred: false,
      isArchived: false,
      updatedAt: null,
      previewImage: null,
      tags: [],
    });
    expect(screen.getByText("https://example.com/x")).toBeTruthy();
  });

  it("does not expose row-level star or archive buttons", () => {
    // Row-level actions were removed: those affordances live one tap away
    // inside the article reader (ActionBar). Library is for finding
    // articles to read, not for managing them in place.
    renderCard({
      id: 1,
      title: "Title",
      url: "https://example.com/x",
      domain: "example.com",
      readingTime: null,
      isStarred: false,
      isArchived: false,
      updatedAt: null,
      previewImage: null,
      tags: [],
    });
    expect(screen.queryByLabelText("star")).toBeNull();
    expect(screen.queryByLabelText("archive")).toBeNull();
  });
});
