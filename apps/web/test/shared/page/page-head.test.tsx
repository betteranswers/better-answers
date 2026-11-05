import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { OpenTabProvider } from "@/shared/page/page-toolbar.tsx";
import { sourceFiles } from "@test/source-files.ts";

afterEach(cleanup);

const ALLOWED_ELSEWHERE: Readonly<Record<string, string>> = {
  "app/pages/failed-page.tsx":
    "the failed page has no menu group, and its alert contains the heading",
  "features/auth/auth-page.tsx": "a sign-in page uses its card title as the heading",
  "features/auth/second-factor/recovery-codes.tsx":
    "the recovery codes heading is h1 on sign-in and h3 on Account",
  "shared/knowledge/concept-body.tsx":
    "demotes the h1 inside a concept's markdown to a lower heading",
};

describe("a page's h1", () => {
  it("is rendered only by PageHead, except in the listed files", () => {
    const filesWithH1 = sourceFiles(/\.tsx?$/)
      .filter(({ text }) => /<h1\b|["']h1["']/.test(text))
      .map(({ file }) => file);

    expect(filesWithH1.toSorted()).toEqual(
      ["shared/page/page-head.tsx", ...Object.keys(ALLOWED_ELSEWHERE)].toSorted(),
    );
  });
});

describe("a page head outside a page frame", () => {
  it("renders its heading and summary in place", () => {
    const { container } = render(
      <article>
        <PageHead heading="People" summary="Who can use this workspace." />
      </article>,
    );

    const article = container.querySelector("article");
    expect(article?.querySelector("h1")?.textContent).toBe("People");
    expect(article?.textContent).toContain("Who can use this workspace.");
  });
});

const follows = (before: Node, after: Node): boolean =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("a list's head", () => {
  const head = (
    <ListHead
      heading="Members"
      headingId="members"
      count="8 members"
      action={<button type="button">Invite a Person</button>}
    />
  );

  it("orders the heading, then the count, then the action", () => {
    render(head);

    const heading = screen.getByRole("heading", { level: 2, name: "Members" });
    const count = screen.getByRole("status");
    const action = screen.getByRole("button", { name: "Invite a Person" });
    expect(count.textContent).toBe("8 members");
    expect(follows(heading, count), "the count comes after the heading").toBe(true);
    expect(follows(count, action), "the primary action comes after the count").toBe(true);
  });

  it("shows its heading when no tab is open", () => {
    render(head);

    expect(screen.getByRole("heading", { level: 2 }).className).not.toContain("sr-only");
  });

  it("visually hides its heading when its tab is open", () => {
    render(<OpenTabProvider openTab="members">{head}</OpenTabProvider>);

    expect(screen.getByRole("heading", { level: 2, name: "Members" }).className).toContain(
      "sr-only",
    );
  });
});
