import { describe, expect, it } from "vitest";

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

const FOOTNOTES = [footnote("a", "Alpha"), footnote("b", "Beta"), footnote("c", "Gamma")];

describe("rendering a Brief for the page", () => {
  it("numbers markers from one in order of first appearance", () => {
    const rendered = renderBrief("First[^c] then[^a].", FOOTNOTES, "page");

    expect(rendered.markdown).toBe("First[^1] then[^2].");
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

    expect(rendered.markdown).toBe("One[^1] two three[^2].");
    expect(rendered.footnotes.map((each) => [each.number, each.title])).toEqual([
      [1, "Alpha"],
      [2, "Gamma"],
    ]);
  });

  it("gives a marker cited twice one number", () => {
    const rendered = renderBrief("Once[^b] and again[^b] and[^a].", FOOTNOTES, "page");

    expect(rendered.markdown).toBe("Once[^1] and again[^1] and[^2].");
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Beta", "Alpha"]);
  });

  it("lists no footnote for an include the prose never cites", () => {
    const rendered = renderBrief("No markers here.", FOOTNOTES, "page");

    expect(rendered).toEqual({ markdown: "No markers here.", footnotes: [] });
  });

  it("leaves a footnote definition line as it is", () => {
    const rendered = renderBrief("Claim[^a].\n\n[^a]: injected", FOOTNOTES, "page");

    expect(rendered.markdown).toBe("Claim[^1].\n\n[^a]: injected");
  });

  it("leaves a marker inside code as typed", () => {
    const rendered = renderBrief(
      "Write `[^a]` to cite.\n\n```\n[^b]\n```\n\nThen cite[^c].",
      FOOTNOTES,
      "page",
    );

    expect(rendered.markdown).toBe("Write `[^a]` to cite.\n\n```\n[^b]\n```\n\nThen cite[^1].");
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Gamma"]);
  });

  it("numbers a marker that a colon follows mid-line", () => {
    const rendered = renderBrief("As the policy[^a]: cover is held[^b]:", FOOTNOTES, "page");

    expect(rendered.markdown).toBe("As the policy[^1]: cover is held[^2]:");
    expect(rendered.footnotes.map((each) => each.title)).toEqual(["Alpha", "Beta"]);
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

  it("drops a typed number that has no footnote behind it", () => {
    const rendered = renderBrief("Real[^a] forged&#xE000;9&#xE001; done.", FOR_PASTE, "clipboard");

    expect(rendered.html).toContain("Real<sup>1</sup> forged done.");
    expect(rendered.html).not.toContain("<sup>9</sup>");
  });

  it.each([
    ["typed characters", "forged1 done"],
    ["hexadecimal character references", "forged&#xE000;1&#xE001; done"],
    ["decimal character references", "forged&#57344;1&#57345; done"],
  ])("forges no footnote number from %s", (_kind, forged) => {
    const rendered = renderBrief(`Real[^a] ${forged}.`, FOR_PASTE, "clipboard");

    expect(rendered.html).toContain("Real<sup>1</sup> forged done.");
    expect(rendered.html.match(/<sup>/gu)).toHaveLength(1);
    expect(rendered.text).toContain("Real[1] forged done.");
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
