import { render, screen } from "@testing-library/react-native";
import { describe, it, expect, vi } from "vitest";

vi.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ArticleCard } from "@/components/ArticleCard";

describe("ArticleCard", () => {
  it("renders title, domain, and tags", () => {
    render(
      <ArticleCard
        id={1}
        title="Hello world"
        url="https://example.com/x"
        domain="example.com"
        readingTime={5}
        isStarred={false}
        isArchived={false}
        updatedAt={new Date().toISOString()}
        previewImage={null}
        tags={[{ id: 10, label: "tech", slug: "tech" }]}
      />,
    );
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText(/example.com/)).toBeTruthy();
    expect(screen.getByText("tech")).toBeTruthy();
  });

  it("renders the star indicator when starred", () => {
    render(
      <ArticleCard
        id={1}
        title="x"
        url="https://x"
        domain="x"
        readingTime={null}
        isStarred={true}
        isArchived={false}
        updatedAt={null}
        previewImage={null}
        tags={[]}
      />,
    );
    expect(screen.getByLabelText("starred")).toBeTruthy();
  });

  it("falls back to URL when title is null", () => {
    render(
      <ArticleCard
        id={1}
        title={null}
        url="https://example.com/x"
        domain="example.com"
        readingTime={null}
        isStarred={false}
        isArchived={false}
        updatedAt={null}
        previewImage={null}
        tags={[]}
      />,
    );
    expect(screen.getByText("https://example.com/x")).toBeTruthy();
  });
});
