import { describe, expect, it } from "vitest";

import { paragraphsCompared, sourceLinesOf } from "@/features/inbox/edit-compared.ts";

const changedOf = (paragraphs: readonly { readonly changed: boolean }[]) =>
  paragraphs.map((paragraph) => paragraph.changed);

describe("an edit compared with the current version", () => {
  it("marks only the paragraphs the other version lacks", () => {
    const compared = paragraphsCompared(
      "Leave is 25 days.\n\nCarry over five days.\n\nAsk your manager.",
      "Leave is 28 days.\n\nCarry over five days.\r\n\r\nAsk your manager.",
    );

    expect(changedOf(compared.current)).toEqual([true, false, false]);
    expect(changedOf(compared.proposed)).toEqual([true, false, false]);
    expect(compared.proposed[0]?.text).toBe("Leave is 28 days.");
  });

  it("keeps an inserted paragraph from marking those after it", () => {
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

describe("the suggested sources as words", () => {
  it("names a source by its title, else its resource, alone", () => {
    expect(
      sourceLinesOf([
        { title: "Board minutes", resource: "Board minutes", locator: "p.4" },
        { resource: "Pay policy" },
        { id: "source-3", title: "" },
      ]),
    ).toEqual(["Board minutes", "Pay policy"]);
  });

  it("keeps text sources as given, and absent sources as none", () => {
    expect(sourceLinesOf(["Handbook#p.2", ""])).toEqual(["Handbook#p.2"]);
    expect(sourceLinesOf(undefined)).toEqual([]);
    expect(sourceLinesOf("Handbook")).toEqual([]);
  });
});
