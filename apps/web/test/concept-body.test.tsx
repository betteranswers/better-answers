import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ConceptBody } from "@/features/knowledge/concept-body.tsx";

import { openPages } from "./address-router.tsx";

afterEach(cleanup);

const sourceEntry = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const linksCase = z.object({
  case: z.string().min(1),
  body: z.string().min(1),
  sources: z.union([z.array(z.string()), z.array(sourceEntry)]),
  marks: z.array(z.object({ mark: z.string().min(1), source: z.int().nonnegative() })),
});

const fixture = z
  .object({ cases: z.array(linksCase).min(1) })
  .parse(
    JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../../contracts/links/cases.json"),
        "utf8",
      ),
    ),
  );

type Evidence = Parameters<typeof ConceptBody>[0]["evidence"];

/** Each source as the read gives it: its label, its id where the entry has one, and a passage to open. */
const evidenceOf = (sources: z.output<typeof linksCase>["sources"]): Evidence =>
  sources.map((entry, at) => {
    const locator = `01J6QQQQQQQQQQQQQQQQQQQQQQ/chars:${String(at)}-9`;
    if (typeof entry === "string") return { source: entry, locator };
    const { id, resource } = entry;
    const source = String(resource);
    return id === undefined || id === null
      ? { source, locator }
      : { id: String(id), source, locator };
  });

const NOTHING_OPEN = { openerId: undefined, onOpen: () => undefined, inline: undefined };

const drawn = async (
  body: string,
  evidence: Evidence,
  opening: Parameters<typeof ConceptBody>[0]["opening"] = NOTHING_OPEN,
) => {
  await openPages(
    {
      "/": () => (
        <article>
          <ConceptBody body={body} evidence={evidence} opening={opening} />
        </article>
      ),
    },
    ["/"],
  );
  return screen.getByRole("article");
};

const marksIn = (article: HTMLElement): readonly (string | null)[] =>
  within(article)
    .queryAllByRole("button")
    .map((mark) => mark.getAttribute("aria-label"));

const HANDBOOK = [
  { id: "a", source: "Staff handbook", locator: "01J6QQQQQQQQQQQQQQQQQQQQQQ/chars:0-9" },
];

const PRODUCT = "01J6NNNNNNNNNNNNNNNNNNNNNN";

describe("a concept's body", () => {
  it("resolves every links case's marks as the fixture says", async () => {
    const resolved = [];
    for (const each of fixture.cases) {
      const evidence = evidenceOf(each.sources);
      resolved.push({ case: each.case, marks: marksIn(await drawn(each.body, evidence)) });
      cleanup();
    }

    expect(resolved).toEqual(
      fixture.cases.map((each) => ({
        case: each.case,
        marks: each.marks.map(
          ({ source }) =>
            `Source ${String(source + 1)}: ${evidenceOf(each.sources)[source]?.source}`,
        ),
      })),
    );
  });

  it("names a mark by its source and opens it", async () => {
    const onOpen = vi.fn<(chosen: { openerId: string; source: number }) => void>();
    const article = await drawn("Claims close within 30 days.[^a]", HANDBOOK, {
      ...NOTHING_OPEN,
      onOpen,
    });

    const mark = within(article).getByRole("button", { name: "Source 1: Staff handbook" });
    expect(mark.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(mark);

    expect(onOpen).toHaveBeenCalledWith({ openerId: mark.id, source: 0 });
  });

  it("draws a mark whose source opens nothing as text", async () => {
    const article = await drawn("Claims close within 30 days.[^a]", [
      { id: "a", source: "Staff handbook" },
    ]);

    expect(within(article).queryAllByRole("button")).toEqual([]);
    expect(article.textContent).toBe("Claims close within 30 days.[1]");
  });

  it("draws every mark as text where nothing opens them", async () => {
    await openPages(
      {
        "/": () => (
          <article>
            <ConceptBody body="Claims close within 30 days.[^a]" evidence={HANDBOOK} />
          </article>
        ),
      },
      ["/"],
    );
    const article = screen.getByRole("article");

    expect(within(article).queryAllByRole("button")).toEqual([]);
    expect(article.textContent).toBe("Claims close within 30 days.[1]");
  });

  it("draws the open mark's panel under its own paragraph", async () => {
    function Page() {
      const [openerId, setOpenerId] = useState<string>();
      return (
        <article>
          <ConceptBody
            body={"Claims close within 30 days.[^a]\n\nMileage is paid at cost."}
            evidence={HANDBOOK}
            opening={{
              openerId,
              onOpen: (chosen) => {
                setOpenerId(chosen.openerId);
              },
              inline:
                openerId === undefined ? undefined : (
                  <section aria-label="The passage">Clause 4.2</section>
                ),
            }}
          />
        </article>
      );
    }
    await openPages({ "/": Page }, ["/"]);
    const article = screen.getByRole("article");
    const mark = within(article).getByRole("button");
    mark.focus();

    fireEvent.click(mark);

    expect(mark.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement, "opening its panel drew the mark afresh").toBe(mark);
    expect(
      [...(article.firstElementChild?.children ?? [])].map((block) => block.textContent),
    ).toEqual(["Claims close within 30 days.[1]", "Clause 4.2", "Mileage is paid at cost."]);
  });

  it("sends a concept IRI link to that concept's page", async () => {
    const article = await drawn(
      `See [the product](https://better-answers.com/c/${PRODUCT}) for tiers.`,
      [],
    );

    expect(within(article).getByRole("link", { name: "the product" }).getAttribute("href")).toBe(
      `/knowledge/search/${PRODUCT}`,
    );
  });

  it("keeps a web link the file wrote, and no referrer", async () => {
    const article = await drawn("See [the regulator](https://example.test/regulator).", []);
    const link = within(article).getByRole("link", { name: "the regulator" });

    expect(link.getAttribute("href")).toBe("https://example.test/regulator");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it.each([
    ["a script link", "[the rates](javascript:alert(1))"],
    ["a file beside it", "[the rates](rates.md)"],
    ["a place on this site", "[the rates](/people/members)"],
    ["another site without its scheme", "[the rates](//example.test/rates)"],
  ])("draws %s as its words alone", async (_, link) => {
    const article = await drawn(`See ${link}.`, []);

    expect(within(article).queryAllByRole("link")).toEqual([]);
    expect(article.textContent).toBe("See the rates.");
  });

  it("draws raw HTML as the text the file wrote", async () => {
    const article = await drawn(
      'Before <script>alert(1)</script> and <a href="https://example.test/x">a link</a>.\n\n<iframe src="https://example.test/frame"></iframe>',
      [],
    );

    expect(article.querySelectorAll("script, iframe, a")).toHaveLength(0);
    expect(article.textContent).toContain("<script>alert(1)</script>");
    expect(article.textContent).toContain('<iframe src="https://example.test/frame"></iframe>');
  });

  it("draws an image as its alt text, fetching nothing", async () => {
    const article = await drawn("![The approval flow](https://example.test/flow.png)", []);

    expect(article.querySelectorAll("img, picture, source, [src], [srcset]")).toHaveLength(0);
    expect(article.textContent).toBe("The approval flow");
  });

  it("keeps a footnote naming no source under a Footnotes heading", async () => {
    const article = await drawn(
      "Mileage follows the rates policy.[^b]\n\n[^b]: Reviewed each April.",
      HANDBOOK,
    );

    expect(marksIn(article)).toEqual([]);
    expect(within(article).getByRole("heading", { name: "Footnotes" })).toBeDefined();
    expect(within(article).getByRole("listitem").textContent.trim()).toBe(
      "Reviewed each April. Back to the claim",
    );
    expect(within(article).getByRole("link", { name: "Back to the claim" })).toBeDefined();
  });
});
