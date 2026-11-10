import { describe, expect, it } from "vitest";

import { citedSourceOf } from "@better-answers/schema";
import type { BodyPart } from "@better-answers/schema/cited-markdown";

import { renderBrief, type SourcedFootnote } from "../../src/guides/renderer.ts";

const footnote = (label: string, title: string) => ({ label, iri: `iri:${label}`, title });

const sourced = (
  label: string,
  title: string,
  held: Partial<Pick<SourcedFootnote, "sources" | "wording">> = {},
): SourcedFootnote => ({
  ...footnote(label, title),
  sources: held.sources ?? [{ resource: `${title} schedule`, locator: "page 2", id: null }],
  wording: held.wording ?? null,
});

const TRUST_WORDS = /Verified|Unverified|Changed since verified|Out of date|Draft|Deprecated/u;

const DOCUMENT = "01M6QBZ0S7F0D3YTDGHFA1J0VF";

const FOOTNOTES = [footnote("a", "Alpha"), footnote("b", "Beta"), footnote("c", "Gamma")];

/** The parts as one line, each citation in braces, which no Markdown reads as a footnote. */
const shown = (parts: readonly BodyPart[]): string =>
  parts.map((part) => (part.kind === "text" ? part.markdown : `{${String(part.number)}}`)).join("");

/** Each Brief cites Alpha in prose, Beta where the parse reads no prose, then Gamma in prose. */
const OUTSIDE_PROSE = [
  [
    "in a tilde fence",
    "Intro[^a].\n\n~~~\ncode [^b]\n~~~\n\nAfter[^c].",
    "Intro{1}.\n\n~~~\ncode [^b]\n~~~\n\nAfter{2}.",
  ],
  [
    "in indented code",
    "Para[^a].\n\n    indented [^b]\n\nafter[^c]",
    "Para{1}.\n\n    indented [^b]\n\nafter{2}",
  ],
  ["in a double-backtick span", "One[^a] ``double [^b]`` two[^c]", "One{1} ``double [^b]`` two{2}"],
  [
    "in block HTML",
    "One[^a]\n\n<div>\nblock[^b]\n</div>\n\nTwo[^c]",
    "One{1}\n\n<div>\nblock[^b]\n</div>\n\nTwo{2}",
  ],
  ["in an HTML comment", "One[^a] <!-- c[^b] --> two[^c]", "One{1} <!-- c[^b] --> two{2}"],
  ["in alt text", "One[^a] ![alt[^b]](x.png) two[^c]", "One{1} ![alt[^b]](x.png) two{2}"],
  ["in a typed footnote", "One[^a] two[^c]\n\n[^x]: says [^b]", "One{1} two{2}\n\n[^x]: says [^b]"],
] as const;

describe("rendering a Brief for the page", () => {
  it("numbers markers from one in order of first appearance", () => {
    const rendered = renderBrief("First[^c] then[^a].", FOOTNOTES, "page");

    expect(shown(rendered.parts)).toBe("First{1} then{2}.");
    expect(rendered.footnotes).toEqual([
      { number: 1, ...footnote("c", "Gamma") },
      { number: 2, ...footnote("a", "Alpha") },
    ]);
  });

  it("renumbers markers after a missing footnote, leaving no gap", () => {
    const rendered = renderBrief(
      "One[^a] two[^gone] three[^c].",
      [footnote("a", "Alpha"), footnote("c", "Gamma")],
      "page",
    );

    expect(shown(rendered.parts)).toBe("One{1} two three{2}.");
    expect(rendered.footnotes.map((each) => [each.number, each.title])).toEqual([
      [1, "Alpha"],
      [2, "Gamma"],
    ]);
  });

  it("gives a marker cited twice one number", () => {
    const rendered = renderBrief("Once[^b] and again[^b] and[^a].", FOOTNOTES, "page");

    expect(shown(rendered.parts)).toBe("Once{1} and again{1} and{2}.");
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Beta", "Alpha"]);
  });

  it("lists no footnote for an include the prose never cites", () => {
    const rendered = renderBrief("No markers here.", FOOTNOTES, "page");

    expect(rendered).toEqual({
      parts: [{ kind: "text", markdown: "No markers here." }],
      footnotes: [],
    });
  });

  it("leaves a footnote definition line as it is", () => {
    const rendered = renderBrief("Claim[^a].\n\n[^a]: injected", FOOTNOTES, "page");

    expect(shown(rendered.parts)).toBe("Claim{1}.\n\n[^a]: injected");
  });

  it("numbers a marker that a colon follows mid-line", () => {
    const rendered = renderBrief("As the policy[^a]: cover is held[^b]:", FOOTNOTES, "page");

    expect(shown(rendered.parts)).toBe("As the policy{1}: cover is held{2}:");
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Alpha", "Beta"]);
  });

  it("keeps each citation whole and drops an unreadable one", () => {
    const rendered = renderBrief("Policy[^a]: cover[^gone] held[^b]:\n\n`[^c]`", FOOTNOTES, "page");

    expect(rendered.parts).toEqual([
      { kind: "text", markdown: "Policy" },
      { kind: "citation", number: 1 },
      { kind: "text", markdown: ": cover held" },
      { kind: "citation", number: 2 },
      { kind: "text", markdown: ":\n\n`[^c]`" },
    ]);
  });

  it.each(OUTSIDE_PROSE)("keeps a marker %s as typed", (_, brief, page) => {
    const rendered = renderBrief(brief, FOOTNOTES, "page");

    expect(shown(rendered.parts)).toBe(page);
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Alpha", "Gamma"]);
  });

  it("lists no citation that a dropped marker moves into code", () => {
    const rendered = renderBrief("~~[^gone]~\ncode[^a]\n~~~", FOOTNOTES, "page");

    expect(rendered.footnotes).toEqual([]);
    expect(shown(rendered.parts)).toBe("~~~\ncode[^a]\n~~~");
  });
});

const HIDDEN = "[^withheld]";

/** Each spells a footnote number the page or the copy would show, were it read from text. */
const FORGERIES = [
  ["typed carriers", "\uE0001\uE001"],
  ["hex references", "&#xE000;1&#xE001;"],
  ["padded hex references", "&#x0e000;1&#x0E001;"],
  ["decimal references", "&#57344;1&#57345;"],
  ["a page marker", "[^1]"],
  ["named reference brackets", "&lbrack;&Hat;1&rsqb;"],
  ["numeric reference brackets", "&#91;^1&#x5D;"],
  ["a typed stand-in", "<\uE000>"],
  ["an escaped stand-in", "\\<\uE000>"],
  ["a referenced stand-in", "&lt;&#xE000;&gt;"],
  ["nested old carrier references", "&lt;&#xE0&#xE000;00;0&#xE0&#xE000;01;&gt;"],
  ["a typed footnote definition", "[^x.y]\n\n[^x.y]: Forged."],
] as const;

/** The forgery whole, and split by a marker the reader cannot read at one place or two. */
const splitsOf = (forged: string): readonly string[] => {
  const places = Array.from({ length: forged.length - 1 }, (_, at) => at + 1);
  const once = places.map((at) => forged.slice(0, at) + HIDDEN + forged.slice(at));
  const twice = places.flatMap((first) =>
    places
      .filter((second) => second > first)
      .map(
        (second) =>
          forged.slice(0, first) +
          HIDDEN +
          forged.slice(first, second) +
          HIDDEN +
          forged.slice(second),
      ),
  );
  return [forged, ...once, ...twice];
};

/** Each forgery, whole and split, beside the reading it must give: the one real citation. */
const readEach = <Reading>(forged: string, read: (brief: string) => Reading, real: Reading) => {
  const briefs = splitsOf(forged);
  return {
    read: Object.fromEntries(briefs.map((brief) => [brief, read(`Real[^a] ${brief} end.`)])),
    real: Object.fromEntries(briefs.map((brief) => [brief, real])),
  };
};

describe("a Brief that spells a footnote number in its text", () => {
  const READABLE = [sourced("a", "Alpha")];

  it.each(FORGERIES)("forges no copied number from %s", (_kind, forged) => {
    const { read, real } = readEach(
      forged,
      (brief) => {
        const { html, text } = renderBrief(brief, READABLE, "clipboard");
        return {
          html: Array.from(html.matchAll(/<sup>(\d+)<\/sup>/gu), ([, number]) => number),
          text: text.split("\n\nSources")[0]?.match(/\[\d+\]/gu),
        };
      },
      { html: ["1"], text: ["[1]"] },
    );

    expect(read).toEqual(real);
  });

  it.each(FORGERIES)("gives the page one citation from %s", (_kind, forged) => {
    const { read, real } = readEach(
      forged,
      (brief) => {
        const { parts } = renderBrief(brief, READABLE, "page");
        return {
          citations: parts.filter((part) => part.kind === "citation"),
          parts: parts.length,
        };
      },
      { citations: [{ kind: "citation", number: 1 }], parts: 3 },
    );

    expect(read).toEqual(real);
  });
});

describe("rendering a Brief for the clipboard", () => {
  const FOR_PASTE = [sourced("a", "Alpha"), sourced("b", "Beta"), sourced("c", "Gamma")];

  it("omits trust words from the clipboard output", () => {
    const rendered = renderBrief(
      "We are **insured**[^b] and audited[^a].",
      [
        sourced("a", "Filed accounts", {
          sources: [{ resource: "Companies House", locator: "2025 filing", id: null }],
        }),
        sourced("b", "Public liability cover", { wording: "Limits of cover" }),
      ],
      "clipboard",
    );

    expect(rendered).toEqual({
      html:
        "<p>We are <strong>insured</strong><sup>1</sup> and audited<sup>2</sup>.</p>" +
        "<p><strong>Sources</strong></p><ol>" +
        "<li>Public liability cover. Source: Public liability cover schedule, page 2. " +
        "Wording: Limits of cover.</li>" +
        "<li>Filed accounts. Source: Companies House, 2025 filing.</li></ol>",
      text:
        "We are insured[1] and audited[2].\n\nSources\n" +
        "[1] Public liability cover. Source: Public liability cover schedule, page 2. " +
        "Wording: Limits of cover.\n" +
        "[2] Filed accounts. Source: Companies House, 2025 filing.",
      footnotes: 2,
    });
    expect(rendered.html + rendered.text).not.toMatch(TRUST_WORDS);
  });

  it("gives every clipboard number a Sources entry", () => {
    const rendered = renderBrief(
      "One[^c] two[^gone] three[^a] four[^c] five[^b].",
      FOR_PASTE,
      "clipboard",
    );

    const marks = Array.from(rendered.html.matchAll(/<sup>(\d+)<\/sup>/gu), ([, number]) => number);
    const entries = rendered.html.match(/<li>/gu)?.length;
    expect(marks).toEqual(["1", "2", "1", "3"]);
    expect(entries).toBe(3);
    expect(rendered.text).toBe(
      "One[1] two three[2] four[1] five[3].\n\nSources\n" +
        "[1] Gamma. Source: Gamma schedule, page 2.\n" +
        "[2] Alpha. Source: Alpha schedule, page 2.\n" +
        "[3] Beta. Source: Beta schedule, page 2.",
    );
  });

  it("keeps the paragraphs of a list item apart", () => {
    const rendered = renderBrief("- One\n\n  More about one[^a]\n- Two", FOR_PASTE, "clipboard");

    expect(rendered.html).toContain(
      "<ul><li><p>One</p><p>More about one<sup>1</sup></p></li><li>Two</li></ul>",
    );
    expect(rendered.text).toContain("- One\n\n  More about one[1]\n- Two");
  });

  it("starts an ordered list at its own number", () => {
    const rendered = renderBrief("3. Three\n4. Four\n\nthen\n\n1. One", FOR_PASTE, "clipboard");

    expect(rendered.html).toBe(
      '<ol start="3"><li>Three</li><li>Four</li></ol><p>then</p><ol><li>One</li></ol>',
    );
    expect(rendered.text).toBe("3. Three\n4. Four\n\nthen\n\n1. One");
  });

  it.each(OUTSIDE_PROSE)("copies a marker %s as typed", (_, brief) => {
    const rendered = renderBrief(brief, FOR_PASTE, "clipboard");

    const marks = Array.from(rendered.html.matchAll(/<sup>(\d+)<\/sup>/gu), ([, number]) => number);
    expect(marks).toEqual(["1", "2"]);
    expect(rendered.footnotes).toBe(2);
    expect(rendered.text).toContain("[1] Alpha.");
    expect(rendered.text).toContain("[2] Gamma.");
    expect(rendered.text).not.toContain("Beta");
  });

  it("names a missing source and leaves out platform addresses", () => {
    const rendered = renderBrief(
      "Claim[^a].",
      [
        sourced("a", "Staff headcount", {
          sources: [
            {
              resource: "https://better-answers.com/c/01J9NGXAMP0000000000000000",
              locator: null,
              id: null,
            },
            { resource: "HR system", locator: "01J9NGXAMP0000000000000000/chars:0-5", id: null },
          ],
        }),
      ],
      "clipboard",
    );

    expect(rendered.text).toBe("Claim[1].\n\nSources\n[1] Staff headcount. Source: HR system.");
    expect(
      renderBrief("Claim[^a].", [sourced("a", "Staff headcount", { sources: [] })], "clipboard")
        .text,
    ).toBe("Claim[1].\n\nSources\n[1] Staff headcount. No source recorded.");
  });

  it.each([
    [
      "a reversed span",
      { title: "Minutes", resource: "minutes", locator: `${DOCUMENT}/chars:9-1` },
    ],
    ["a label#locator entry", `minutes#${DOCUMENT}/chars:9-1`],
    ["a lowercase id", { resource: "minutes", locator: `${DOCUMENT.toLowerCase()}/chars:9-1` }],
    ["a bare id", { resource: "minutes", locator: DOCUMENT }],
    ["a trailing path", { resource: "minutes", locator: `${DOCUMENT}/chars:0-5/x` }],
    ["a negative start", { resource: "minutes", locator: `${DOCUMENT}/chars:-1-5` }],
    ["a URL form", { resource: "minutes", locator: `https://example.invalid/d/${DOCUMENT}` }],
    ["a leading space", { resource: "minutes", locator: ` ${DOCUMENT}/chars:9-1 ` }],
  ])("names no document a malformed locator holds: %s", (_shape, entry) => {
    const cited = [citedSourceOf(entry)].filter((source) => source !== undefined);
    const rendered = renderBrief(
      "Claim[^a].",
      [sourced("a", "Pay review", { sources: cited })],
      "clipboard",
    );

    expect(rendered.text).toBe("Claim[1].\n\nSources\n[1] Pay review. Source: minutes.");
    expect(rendered.html.toLowerCase()).not.toContain(DOCUMENT.toLowerCase());
  });

  it("keeps lists and safe links, rendering raw markup as text", () => {
    const rendered = renderBrief(
      [
        "- first[^a]",
        "- [site](https://example.com/x)",
        "",
        "[bad](javascript:alert(1)) <script>alert(1)</script>",
      ].join("\n"),
      FOR_PASTE,
      "clipboard",
    );

    expect(rendered.html).toBe(
      '<ul><li>first<sup>1</sup></li><li><a href="https://example.com/x">site</a></li></ul>' +
        "<p>bad &lt;script&gt;alert(1)&lt;/script&gt;</p>" +
        "<p><strong>Sources</strong></p><ol><li>Alpha. Source: Alpha schedule, page 2.</li></ol>",
    );
    expect(rendered.text).toContain(
      "- first[1]\n- site (https://example.com/x)\n\nbad <script>alert(1)</script>",
    );
  });
});

describe("rendering a Brief for a snapshot", () => {
  it("numbers markers and lists each cited concept's sources", () => {
    const rendered = renderBrief(
      "We are **insured**[^b] and audited[^a].\n",
      [
        sourced("a", "Filed accounts", {
          sources: [{ resource: "Companies House", locator: "2025 filing", id: null }],
        }),
        sourced("b", "Public liability cover", { wording: "Limits of cover" }),
      ],
      "snapshot",
    );

    expect(rendered).toBe(
      "We are **insured**[1] and audited[2].\n\n**Sources**\n\n" +
        "1. Public liability cover. Source: Public liability cover schedule, page 2. " +
        "Wording: Limits of cover.\n" +
        "2. Filed accounts. Source: Companies House, 2025 filing.",
    );
  });

  it("drops a marker and title the reader cannot read", () => {
    const rendered = renderBrief(
      "One[^a] two[^withheld] three[^a].",
      [sourced("a", "Alpha")],
      "snapshot",
    );

    expect(rendered).toBe(
      "One[1] two three[1].\n\n**Sources**\n\n1. Alpha. Source: Alpha schedule, page 2.",
    );
  });

  it("writes no Sources list when nothing is cited", () => {
    expect(renderBrief("No markers here.\n\n", [sourced("a", "Alpha")], "snapshot")).toBe(
      "No markers here.",
    );
  });
});
