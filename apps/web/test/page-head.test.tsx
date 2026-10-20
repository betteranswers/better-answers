import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { OpenTabProvider } from "@/shared/page-toolbar.tsx";

import { sourceFiles } from "./source-files.ts";

afterEach(cleanup);

const ALLOWED_ELSEWHERE: Readonly<Record<string, string>> = {
  "app/failed-page.tsx": "the failed page names no menu group, and its alert holds the heading",
  "features/auth/auth-page.tsx": "a sign-in page's heading is its card's title",
  "features/auth/recovery-codes.tsx":
    "the codes' heading is h1 on a sign-in page and h3 on Account",
  "shared/knowledge/concept-body.tsx": "names a concept's own h1 only to draw it lower",
};

describe("a page's h1", () => {
  it("is drawn by PageHead alone, apart from the files named", () => {
    const naming = sourceFiles(/\.tsx?$/)
      .filter(({ text }) => /<h1\b|["']h1["']/.test(text))
      .map(({ file }) => file);

    expect(naming.toSorted()).toEqual(
      ["shared/page-head.tsx", ...Object.keys(ALLOWED_ELSEWHERE)].toSorted(),
    );
  });
});

describe("a page's head with no frame around it", () => {
  it("draws its heading and summary where it stands", () => {
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

describe("a list's head", () => {
  const head = (
    <ListHead
      heading="Members"
      headingId="members"
      count="8 members"
      action={<button type="button">Invite a Person</button>}
    />
  );

  it("reads heading, then count, then the primary action", () => {
    render(head);

    const read = [
      screen.getByRole("heading", { level: 2, name: "Members" }),
      screen.getByRole("status"),
      screen.getByRole("button", { name: "Invite a Person" }),
    ];
    expect(screen.getByRole("status").textContent).toBe("8 members");
    for (const [index, part] of read.slice(1).entries()) {
      const before = read[index];
      expect(
        before === undefined
          ? 0
          : before.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    }
  });

  it("shows its heading where no tab names the list", () => {
    render(head);

    expect(screen.getByRole("heading", { level: 2 }).className).not.toContain("sr-only");
  });

  it("hides its heading from the eye under an open tab", () => {
    render(<OpenTabProvider openTab="members">{head}</OpenTabProvider>);

    expect(screen.getByRole("heading", { level: 2, name: "Members" }).className).toContain(
      "sr-only",
    );
  });
});
