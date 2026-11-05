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

  it("renumbers markers past a missing footnote, leaving no gap", () => {
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

  it("lists no footnote for an include the prose never places", () => {
    const rendered = renderBrief("No markers here.", FOOTNOTES, "page");

    expect(rendered).toEqual({ markdown: "No markers here.", footnotes: [] });
  });

  it("leaves a footnote definition line as it is", () => {
    const rendered = renderBrief("Claim[^a].\n\n[^a]: injected", FOOTNOTES, "page");

    expect(rendered.markdown).toBe("Claim[^1].\n\n[^a]: injected");
  });
});

describe("rendering a Brief for the clipboard", () => {
  const FOR_PASTE = [sourced("a", "Alpha"), sourced("b", "Beta"), sourced("c", "Gamma")];

  it("the clipboard profile carries no trust word", () => {
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

  it("every clipboard number has a Sources entry", () => {
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

  it("drops a forged number with no footnote behind it", () => {
    const rendered = renderBrief("Real[^a] forged&#xE000;9&#xE001; done.", FOR_PASTE, "clipboard");

    expect(rendered.html).toContain("Real<sup>1</sup> forged done.");
    expect(rendered.html).not.toContain("<sup>9</sup>");
  });

  it("names a missing source and omits platform addresses", () => {
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

  it("keeps lists and safe links, shows raw markup as text", () => {
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
