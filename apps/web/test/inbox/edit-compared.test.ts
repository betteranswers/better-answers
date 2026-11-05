import { describe, expect, it } from "vitest";

import { paragraphsCompared, sourceLinesOf } from "@/features/inbox/edit-compared.ts";

const changedOf = (paragraphs: readonly { readonly changed: boolean }[]) =>
  paragraphs.map((paragraph) => paragraph.changed);

describe("comparing a suggested edit with the current version", () => {
  it("marks only the paragraphs the other version lacks", () => {
    const compared = paragraphsCompared(
      "Leave is 25 days.\n\nCarry over five days.\n\nAsk your manager.",
      "Leave is 28 days.\n\nCarry over five days.\r\n\r\nAsk your manager.",
    );

    expect(changedOf(compared.current)).toEqual([true, false, false]);
    expect(changedOf(compared.proposed)).toEqual([true, false, false]);
    expect(compared.proposed[0]?.text).toBe("Leave is 28 days.");
  });

  it("marks an inserted paragraph but not the paragraphs after it", () => {
    const compared = paragraphsCompared("One.\n\nTwo.\n\n", "\n\nOne.\n\nNew.\n  \nTwo.");

    expect(changedOf(compared.current)).toEqual([false, false]);
    expect(changedOf(compared.proposed)).toEqual([false, true, false]);
  });

  it("marks nothing for a new concept with no current version", () => {
    const compared = paragraphsCompared(null, "First.\n\nSecond.");

    expect(compared.current).toEqual([]);
    expect(changedOf(compared.proposed)).toEqual([false, false]);
  });
});

describe("listing suggested sources", () => {
  it("names a source by its title, or else its resource", () => {
    expect(
      sourceLinesOf([
        { title: "Board minutes", resource: "Board minutes", locator: "p.4" },
        { resource: "Pay policy" },
        { id: "source-3", title: "" },
      ]),
    ).toEqual(["Board minutes", "Pay policy"]);
  });

  it("keeps text sources and lists none when sources are missing", () => {
    expect(sourceLinesOf(["Handbook#p.2", ""])).toEqual(["Handbook#p.2"]);
    expect(sourceLinesOf(undefined)).toEqual([]);
    expect(sourceLinesOf("Handbook")).toEqual([]);
  });
});
