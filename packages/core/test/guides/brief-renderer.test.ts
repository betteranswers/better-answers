import { describe, expect, it } from "vitest";

import { renderBrief } from "../../src/guides/renderer.ts";

const footnote = (label: string, title: string) => ({ label, iri: `iri:${label}`, title });

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
