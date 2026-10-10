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

/** The two private-use characters a mark is carried between, which no file may write its own. */
const OPENS = String.fromCodePoint(0xe000);

const CLOSES = String.fromCodePoint(0xe001);

/** A body whose marks open a panel, drawn where the body puts it. */
function Opening(properties: { readonly body: string }) {
  const [openerId, setOpenerId] = useState<string>();
  return (
    <article>
      <ConceptBody
        body={properties.body}
        evidence={HANDBOOK}
        opening={{
          openerId,
          onOpen: (chosen) => {
            setOpenerId(chosen.openerId);
          },
          inline: openerId === undefined ? undefined : <section>Clause 4.2</section>,
        }}
      />
    </article>
  );
}

/** The body's blocks as drawn, less every attribute, each mark as its number alone. */
const blocksOf = (article: HTMLElement): string => {
  const copy = article.firstElementChild?.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return "";
  for (const mark of copy.querySelectorAll("sup")) mark.replaceWith(mark.textContent);
  for (const element of copy.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) element.removeAttribute(name);
  }
  return copy.innerHTML.replaceAll("\n", "");
};

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

  it("keeps the open mark drawn as its panel opens", async () => {
    await openPages(
      {
        "/": () => (
          <Opening body={"Claims close within 30 days.[^a]\n\nMileage is paid at cost."} />
        ),
      },
      ["/"],
    );
    const mark = screen.getByRole("button", { name: "Source 1: Staff handbook" });
    mark.focus();

    fireEvent.click(mark);

    expect(mark.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement, "opening its panel drew the mark afresh").toBe(mark);
  });

  it.each([
    [
      "a paragraph",
      "Claims close within 30 days.[^a]\n\nMileage is paid at cost.",
      "<p>Claims close within 30 days.[1]</p><section>Clause 4.2</section><p>Mileage is paid at cost.</p>",
    ],
    [
      "a list item's own words",
      "- Kept seven years.[^a]\n- Deleted after.",
      "<ul><li>Kept seven years.[1]<section>Clause 4.2</section></li><li>Deleted after.</li></ul>",
    ],
    [
      "an item, above its nested list",
      "- Kept seven years.[^a]\n  - Then deleted.",
      "<ul><li>Kept seven years.[1]<section>Clause 4.2</section><ul><li>Then deleted.</li></ul></li></ul>",
    ],
    [
      "a quoted paragraph",
      "> Kept seven years.[^a]\n\nMileage is paid at cost.",
      "<blockquote><p>Kept seven years.[1]</p><section>Clause 4.2</section></blockquote><p>Mileage is paid at cost.</p>",
    ],
  ])("puts the panel under %s", async (_, body, drawnAs) => {
    await openPages({ "/": () => <Opening body={body} /> }, ["/"]);
    fireEvent.click(screen.getByRole("button", { name: "Source 1: Staff handbook" }));

    expect(blocksOf(screen.getByRole("article"))).toBe(drawnAs);
  });

  it("draws a table cell's panel under its whole table", async () => {
    await openPages(
      {
        "/": () => (
          <Opening
            body={"| Rule | Kept |\n| --- | --- |\n| Audit logs | Seven years.[^a] |\n\nAfter."}
          />
        ),
      },
      ["/"],
    );
    fireEvent.click(screen.getByRole("button", { name: "Source 1: Staff handbook" }));

    const prose = screen.getByRole("article").firstElementChild;
    expect([...(prose?.children ?? [])].map((block) => block.tagName)).toEqual([
      "DIV",
      "SECTION",
      "P",
    ]);
    expect(prose?.querySelector("table section")).toBeNull();
  });

  it.each([
    ["strong words", "**Kept for seven years.**[^a]", "strong", "Kept for seven years."],
    ["underscored words", "_Kept for seven years._[^a]", "em", "Kept for seven years."],
    ["quoted emphasis", '*"As agreed."*[^a]', "em", '"As agreed."'],
    ["struck words", "~~The old rule.~~[^a]", "del", "The old rule."],
    ["emphasis after it", "Kept.[^a]*(see the note)*", "em", "(see the note)"],
  ])("keeps %s beside a mark", async (_, body, tag, words) => {
    const article = await drawn(body, HANDBOOK);

    expect(article.querySelector(tag)?.textContent).toBe(words);
    expect(marksIn(article)).toEqual(["Source 1: Staff handbook"]);
    expect(article.textContent).not.toMatch(/[*_~]/);
  });

  it.each([
    [
      "a bare web address",
      "The rule is at https://example.test/rules[^a] for all staff.",
      "https://example.test/rules",
    ],
    [
      "a bare concept IRI",
      `See https://better-answers.com/c/${PRODUCT}[^a] for tiers.`,
      `/knowledge/search/${PRODUCT}`,
    ],
  ])("ends %s at the mark after it", async (_, body, address) => {
    const article = await drawn(body, HANDBOOK);

    expect(within(article).getByRole("link").getAttribute("href")).toBe(address);
    expect(marksIn(article)).toEqual(["Source 1: Staff handbook"]);
  });

  it("keeps a link definition's address when a mark ends it", async () => {
    const article = await drawn(
      "See [the rules][rules].\n\n[rules]: https://example.test/rules[^a]",
      HANDBOOK,
    );

    expect(within(article).getByRole("link", { name: "the rules" }).getAttribute("href")).toBe(
      "https://example.test/rules",
    );
  });

  it.each([
    ["written out", `<${OPENS}0${CLOSES}>`],
    ["as hexadecimal references", "&lt;&#xE000;0&#xe001;&gt;"],
    ["as decimal references", "<&#57344;0&#0057345;>"],
  ])("draws no mark for a forged carrier, %s", async (_, forged) => {
    const article = await drawn(
      `Claims close within 30 days.[^a] Forged here: ${forged}.`,
      HANDBOOK,
    );

    expect(marksIn(article)).toEqual(["Source 1: Staff handbook"]);
    expect(article.textContent).toBe("Claims close within 30 days.[1] Forged here: <0>.");
  });

  it("reads a label as written, carrier characters included", async () => {
    const article = await drawn(`Claims close within 30 days.[^a${OPENS}]`, HANDBOOK);

    expect(marksIn(article)).toEqual([]);
    expect(article.textContent).toBe("Claims close within 30 days.[^a]");
  });

  it("moves between a footnote and its claim, address unchanged", async () => {
    const { router } = await openPages(
      {
        "/": () => (
          <article>
            <ConceptBody
              body={"Mileage follows the rates policy.[^b]\n\n[^b]: Reviewed each April."}
              evidence={[]}
            />
          </article>
        ),
      },
      ["/"],
    );
    const down = screen.getByRole("link", { name: "1" });
    const back = screen.getByRole("link", { name: "Back to the claim" });

    fireEvent.click(down);
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);

    expect(document.activeElement).toBe(down);
    expect(router.state.location.hash).toBe("");
    expect(router.history.length).toBe(1);
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

  it("keeps a mail address the file wrote", async () => {
    const article = await drawn("Ask [the records team](mailto:records@example.test).", []);

    expect(
      within(article).getByRole("link", { name: "the records team" }).getAttribute("href"),
    ).toBe("mailto:records@example.test");
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

const COMMITTEE = "01J6RRRRRRRRRRRRRRRRRRRRRR";

const TO_THE_COMMITTEE = "../roles/audit-committee.md";

type BodyLinks = NonNullable<Parameters<typeof ConceptBody>[0]["bodyLinks"]>;

/** Each address answered with the committee's concept. */
const answering = (...addresses: readonly string[]): BodyLinks =>
  addresses.map((address) => ({ address, target: `https://better-answers.com/c/${COMMITTEE}` }));

const drawnLinking = async (body: string, bodyLinks: BodyLinks) => {
  await openPages(
    {
      "/": () => (
        <article>
          <ConceptBody body={body} evidence={[]} bodyLinks={bodyLinks} />
        </article>
      ),
    },
    ["/"],
  );
  return screen.getByRole("article");
};

const addressesIn = (article: HTMLElement): readonly (string | null)[] =>
  within(article)
    .queryAllByRole("link")
    .map((link) => link.getAttribute("href"));

describe("a body's links to other concepts", () => {
  it("draws an answered relative link to its concept's page", async () => {
    const article = await drawnLinking(
      `See the [Audit Committee](${TO_THE_COMMITTEE}).`,
      answering(TO_THE_COMMITTEE),
    );

    expect(
      within(article).getByRole("link", { name: "Audit Committee" }).getAttribute("href"),
    ).toBe("/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR");
  });

  it("draws an unanswered link beside it as its words", async () => {
    const article = await drawnLinking(
      `See the [Audit Committee](${TO_THE_COMMITTEE}) and [the rates](rates.md).`,
      answering(TO_THE_COMMITTEE),
    );

    expect(addressesIn(article)).toEqual(["/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR"]);
    expect(article.textContent).toBe("See the Audit Committee and the rates.");
  });

  it("draws both links of an address written twice", async () => {
    const article = await drawnLinking(
      `See [the committee](${TO_THE_COMMITTEE}), [again](${TO_THE_COMMITTEE}).`,
      answering(TO_THE_COMMITTEE, TO_THE_COMMITTEE),
    );

    expect(addressesIn(article)).toEqual([
      "/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR",
      "/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR",
    ]);
  });

  it("leaves an address's fragment off the page's address", async () => {
    const article = await drawnLinking(
      `See [its duties](${TO_THE_COMMITTEE}#duties).`,
      answering(`${TO_THE_COMMITTEE}#duties`),
    );

    expect(addressesIn(article)).toEqual(["/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR"]);
  });

  it("matches an address holding a letter beyond ASCII", async () => {
    const article = await drawnLinking("See [the team](équipe.md).", answering("équipe.md"));

    expect(addressesIn(article)).toEqual(["/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR"]);
  });

  it("draws the body when an address does not decode", async () => {
    const article = await drawnLinking(
      "See [the café](caf%E9.md), [the odd one](x%zz.md) and [the rates](100%.md).",
      answering("100%.md"),
    );

    expect(addressesIn(article)).toEqual(["/knowledge/search/01J6RRRRRRRRRRRRRRRRRRRRRR"]);
    expect(within(article).getByRole("link", { name: "the rates" })).toBeDefined();
    expect(article.textContent).toBe("See the café, the odd one and the rates.");
  });

  it("ignores an entry whose target is no concept", async () => {
    const article = await drawnLinking(
      "See [the rates](rates.md) and [the regulator](https://example.test/regulator).",
      [
        { address: "rates.md", target: "https://example.test/rates" },
        { address: "https://example.test/regulator", target: "javascript:alert(1)" },
      ],
    );

    expect(addressesIn(article)).toEqual(["https://example.test/regulator"]);
    expect(article.textContent).toBe("See the rates and the regulator.");
  });

  it("keeps an answered image as its alt text", async () => {
    const article = await drawnLinking(
      `![The committee's chart](${TO_THE_COMMITTEE})`,
      answering(TO_THE_COMMITTEE),
    );

    expect(article.querySelectorAll("a, img, [src]")).toHaveLength(0);
    expect(article.textContent).toBe("The committee's chart");
  });

  it("keeps a footnote defined as an answered path a jump", async () => {
    const article = await drawnLinking(
      `Mileage follows the rates policy.[^b]\n\n[^b]: ${TO_THE_COMMITTEE}`,
      answering(TO_THE_COMMITTEE),
    );

    expect(addressesIn(article).filter((address) => !address?.startsWith("#"))).toEqual([]);
    expect(within(article).getByRole("listitem").textContent.trim()).toBe(
      "../roles/audit-committee.md Back to the claim",
    );
  });
});
