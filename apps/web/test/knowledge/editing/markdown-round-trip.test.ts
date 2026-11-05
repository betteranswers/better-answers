import { describe, expect, it } from "vitest";

import { losesMarkdown, openingMode } from "@/features/knowledge/editing/markdown-round-trip.ts";

describe("the visual editor's round trip", () => {
  it("finds a table the visual editor would lose", () => {
    const table = "| Item | Kept for |\n| --- | --- |\n| Audit logs | 7 years |";

    expect(losesMarkdown(table), "the table would collapse into one line of text").toBe(true);
  });

  it("keeps plain paragraphs and lists in visual mode", () => {
    const body =
      "## Retention\n\nWe keep **audit logs** for [seven years](https://example.com/policy).\n\n- Logs\n- Backups\n\n1. Ask\n2. Wait";

    expect(losesMarkdown(body), "nothing here changes when the visual editor writes it back").toBe(
      false,
    );
  });

  it("keeps a footnote reference as written", () => {
    expect(
      losesMarkdown("We keep audit logs.[^source-1] They go back seven years.[^source-2]"),
      "the citation to a source stays as it was typed",
    ).toBe(false);
  });

  it("keeps a footnote reference with an underscore label", () => {
    expect(losesMarkdown("Kept for seven years.[^audit_log-2]"), "the label stays whole").toBe(
      false,
    );
  });

  it("finds an image the visual editor would lose", () => {
    expect(
      losesMarkdown("The floor plan: ![Floor plan](https://example.com/plan.png)"),
      "the picture would shrink to its alt text",
    ).toBe(true);
  });

  it("finds a raw HTML block the visual editor would lose", () => {
    expect(
      losesMarkdown('Before.\n\n<div class="note">Keep this.</div>\n\nAfter.'),
      "the HTML block would vanish",
    ).toBe(true);
  });

  it("finds underscore emphasis the visual editor would rewrite", () => {
    expect(losesMarkdown("This is _important_."), "_important_ would become *important*").toBe(
      true,
    );
  });

  it("finds star bullets the visual editor would rewrite", () => {
    expect(losesMarkdown("* Logs\n* Backups"), "the stars would become dashes").toBe(true);
  });

  it("finds a footnote definition the visual editor would lose", () => {
    expect(
      losesMarkdown("We keep audit logs.[^1]\n\n[^1]: The retention policy."),
      "the definition would be escaped into plain text",
    ).toBe(true);
  });

  it("does not count a trailing newline as a loss", () => {
    expect(losesMarkdown("A plain paragraph.\n\n"), "only the final line break differs").toBe(
      false,
    );
  });

  it("keeps an ampersand as written", () => {
    expect(
      losesMarkdown("Terms & Conditions apply to R&D and AT&T."),
      "& stays & and is not spelled &amp;",
    ).toBe(false);
  });

  it("keeps comparison signs in running text", () => {
    expect(
      losesMarkdown("Fewer than 5 staff means x < 5, and 5 > 3."),
      "< and > stay as typed",
    ).toBe(false);
  });

  it("keeps a typed tag as escaped text", () => {
    expect(losesMarkdown("Type &lt;b&gt; for bold."), "the escaped tag stays escaped").toBe(false);
  });

  it("finds an entity the author spelled out", () => {
    expect(losesMarkdown("Fish &amp; chips"), "&amp; would be written as &").toBe(true);
  });

  it("keeps code as written", () => {
    expect(
      losesMarkdown("Use `a && b` or\n\n```\nif (x < 5 && y) {}\n```"),
      "code is never spelled out",
    ).toBe(false);
  });

  it("opens a table in markdown", () => {
    expect(openingMode("| a | b |\n| - | - |\n| 1 | 2 |")).toBe("source");
  });

  it("opens a plain paragraph in the visual editor", () => {
    expect(openingMode("Just a paragraph.")).toBe("visual");
  });

  it("opens an empty body in the visual editor", () => {
    expect(openingMode("")).toBe("visual");
  });
});
