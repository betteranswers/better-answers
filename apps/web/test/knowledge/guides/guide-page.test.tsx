import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GUIDES_PAGE } from "@/features/knowledge/guides/guide-state.ts";
import { GUIDE_WORDS } from "@/features/knowledge/guides/guide-words.ts";
import { asksOf } from "@test/knowledge/concept-editing-answers.ts";
import {
  A_GUIDE_PAGE,
  A_WRITE_UP_ID,
  aBrief,
  aFact,
  aGuide,
  aGuideApi,
  aSection,
  aViewersBrief,
  idOf,
  INCLUDE,
  LIABILITY_TITLE,
  RACKING_IRI,
  RACKING_TITLE,
} from "@test/knowledge/guide-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { aRefusalAnswer, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const openGuide = async (role: "Admin" | "Editor" | "Viewer", guide = aGuide()) => {
  const api = aGuideApi(role, guide);
  const router = await openAt(A_GUIDE_PAGE, api);
  await screen.findByRole("heading", { level: 2, name: "Northgate Ltd" });
  return { api, router };
};

const sectionNamed = (name: string) => screen.getByRole("region", { name });

const numbered = (sections: readonly (readonly [string, string])[]) =>
  aGuide({
    sections: sections.map(([number, prompt], at) =>
      aSection({ sectionId: idOf(21 + at), number, prompt }),
    ),
  });

const SECTION_ONE = "1. Warehouse racking";

describe("the guide page", () => {
  it("draws the guide's subject, kind and total", async () => {
    await openGuide("Editor");

    const article = within(screen.getByRole("article"));
    expect(article.getByText("Bid library")).toBeDefined();
    expect(article.getByRole("link", { name: "Northgate Ltd" })).toBeDefined();
    expect(article.getAllByText("3 of 4 expected facts recorded")).toHaveLength(2);
  });

  it("draws each section in order with its number", async () => {
    await openGuide(
      "Editor",
      numbered([
        ["1", "Racking"],
        ["2", "Insurance"],
        ["2.1", "Cover"],
      ]),
    );

    const headings = screen.getAllByRole("heading").map((each) => each.textContent);
    expect(headings.slice(-3)).toEqual(["1. Racking", "2. Insurance", "2.1. Cover"]);
    expect(screen.getByRole("heading", { name: "2.1. Cover" }).tagName).toBe("H4");
  });

  it("draws the trust word of each section as text", async () => {
    await openGuide("Viewer", aGuide({ sections: [aSection({ trustWords: "Verified by Dana" })] }));

    expect(within(sectionNamed(SECTION_ONE)).getByText("Verified by Dana")).toBeDefined();
  });

  it("numbers the Brief's footnotes and links them to their concepts", async () => {
    await openGuide("Viewer", aGuide({ sections: [aSection({ brief: aViewersBrief() })] }));

    const section = within(sectionNamed(SECTION_ONE));
    expect(section.getByText(/Pallets are racked/u).textContent).toBe(
      "Pallets are racked[1] by row.",
    );
    const footnotes = within(section.getByRole("list", { name: "Footnotes" }));
    const link = footnotes.getByRole("link", { name: RACKING_TITLE });
    expect(link.getAttribute("href")).toContain(RACKING_IRI.slice(-26));
  });

  it("draws no Edit Brief for a Viewer", async () => {
    await openGuide("Viewer", aGuide({ sections: [aSection({ brief: aViewersBrief() })] }));

    expect(screen.queryByRole("button", { name: "Edit Brief" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show Detail" })).toBeDefined();
  });

  it("offers Edit Brief to an Editor and to an Admin", async () => {
    await openGuide("Admin");

    expect(screen.getByRole("button", { name: "Edit Brief" })).toBeDefined();
  });

  it("says an empty Brief has no text yet", async () => {
    const empty = aBrief({ rendered: { markdown: "", footnotes: [] } });
    await openGuide("Editor", aGuide({ sections: [aSection({ brief: empty })] }));

    expect(within(sectionNamed(SECTION_ONE)).getByText(GUIDE_WORDS.noBrief)).toBeDefined();
  });

  it("draws not found for an unknown guide", async () => {
    const api = aGuideApi("Editor");
    api.set("knowledge.guide", () => aRefusalAnswer("not-found", "absent", 404));
    await openAt(A_GUIDE_PAGE, api);

    const main = within(screen.getByRole("main"));
    expect(await main.findByText(/This guide isn’t available/u)).toBeDefined();
    expect(main.getByRole("link", { name: "Back to Guides" }).getAttribute("href")).toBe(
      GUIDES_PAGE.path,
    );
  });
});

describe("a section the reader cannot read", () => {
  const withheld = aGuide({
    sections: [
      aSection({
        number: "3",
        prompt: "Insurance",
        brief: undefined,
        needsReview: "concept-changed",
        coverage: { met: 2, of: 4, facts: [aFact()] },
      }),
    ],
  });

  it("draws its heading, trust word and coverage without any text", async () => {
    await openGuide("Viewer", withheld);

    const section = within(sectionNamed("3. Insurance"));
    expect(section.getByText("Verified automatically")).toBeDefined();
    expect(section.getByText("2 of 4 expected facts recorded")).toBeDefined();
    expect(section.getByText(GUIDE_WORDS.withheld)).toBeDefined();
    expect(section.queryByRole("button")).toBeNull();
    expect(section.queryByText(RACKING_TITLE)).toBeNull();
    expect(screen.queryByText("Each bay is racked by row.")).toBeNull();
  });

  it("still says it needs review", async () => {
    await openGuide("Viewer", withheld);

    const section = within(sectionNamed("3. Insurance"));
    expect(section.getByText("Needs review")).toBeDefined();
    expect(section.getByText("Cites a concept that changed")).toBeDefined();
  });
});

describe("a section that needs review", () => {
  const REASONS = [
    ["concept-changed", "Cites a concept that changed"],
    ["concept-removed", "Cites a concept that was removed"],
    ["expectation-unmet", "Expects a fact that is not yet recorded"],
    ["review-finding", "A review found something to check"],
  ] as const;

  for (const [reason, words] of REASONS) {
    it(`says ${reason} in words to a Viewer`, async () => {
      const guide = aGuide({ sections: [aSection({ needsReview: reason })] });
      await openGuide("Viewer", guide);

      const section = within(sectionNamed(SECTION_ONE));
      expect(section.getByText("Needs review")).toBeDefined();
      expect(section.getByText(words)).toBeDefined();
    });
  }

  it("says nothing of review when none is needed", async () => {
    await openGuide("Viewer");

    expect(screen.queryByText("Needs review")).toBeNull();
  });
});

describe("the Detail of a section", () => {
  it("stays closed until the reader shows it", async () => {
    await openGuide("Viewer");

    expect(screen.queryByText("Each bay is racked by row.")).toBeNull();
    expect(screen.getByRole("button", { name: "Show Detail" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("opens under the Brief and moves focus into it", async () => {
    await openGuide("Viewer");

    fireEvent.click(screen.getByRole("button", { name: "Show Detail" }));

    const detail = await screen.findByRole("region", { name: "Detail of section 1" });
    expect(within(detail).getByText("Each bay is racked by row.")).toBeDefined();
    expect(within(detail).getByRole("link", { name: RACKING_TITLE })).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(detail);
    });
    expect(screen.getByRole("button", { name: "Show Detail" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes when shown again", async () => {
    await openGuide("Viewer");
    const button = screen.getByRole("button", { name: "Show Detail" });

    fireEvent.click(button);
    await screen.findByRole("region", { name: "Detail of section 1" });
    fireEvent.click(button);

    expect(screen.queryByRole("region", { name: "Detail of section 1" })).toBeNull();
  });

  it("opens by default where no assembled layer shows", async () => {
    const quoted = aGuide({ sections: [aSection({ layers: ["quoted"] })] });
    await openGuide("Viewer", quoted);

    const detail = screen.getByRole("region", { name: "Detail of section 1" });
    expect(within(detail).getByText("Each bay is racked by row.")).toBeDefined();
    expect(document.activeElement).not.toBe(detail);
  });

  it("opens on d for the section in focus", async () => {
    await openGuide("Viewer");

    const button = screen.getByRole("button", { name: "Show Detail" });
    button.focus();
    fireEvent.keyDown(button, { key: "d" });

    expect(await screen.findByRole("region", { name: "Detail of section 1" })).toBeDefined();
  });

  it("opens only the section in focus on d", async () => {
    await openGuide(
      "Viewer",
      numbered([
        ["1", "Racking"],
        ["2", "Insurance"],
      ]),
    );

    const second = within(sectionNamed("2. Insurance")).getByRole("button", {
      name: "Show Detail",
    });
    second.focus();
    fireEvent.keyDown(second, { key: "d" });

    expect(await screen.findByRole("region", { name: "Detail of section 2" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Detail of section 1" })).toBeNull();
  });

  it("asks for a section first when none is in focus", async () => {
    await openGuide("Viewer");

    fireEvent.keyDown(document.body, { key: "d" });

    expect(await screen.findByText(GUIDE_WORDS.selectFirst)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Detail of section 1" })).toBeNull();
  });
});

describe("the coverage of a section", () => {
  it("names a missing fact, its owner and Add This Fact", async () => {
    await openGuide("Editor");

    const section = within(sectionNamed(SECTION_ONE));
    expect(section.getByText("3 of 4 expected facts recorded")).toBeDefined();
    const line = section.getByText(`${LIABILITY_TITLE} not yet recorded. Owner Dana Example.`);
    const add = section.getByRole("link", { name: "Add This Fact" });
    expect(add.getAttribute("aria-describedby")).toBe(line.id);
  });

  it("says an Admin decides when the collection has no owner", async () => {
    await openGuide("Viewer", aGuide({ owner: null }));

    expect(
      screen.getByText(
        `${LIABILITY_TITLE} not yet recorded. No owner is named yet, so an Admin decides.`,
      ),
    ).toBeDefined();
  });

  it("offers Add This Fact to a Viewer too", async () => {
    await openGuide("Viewer");

    expect(screen.getByRole("link", { name: "Add This Fact" })).toBeDefined();
  });

  it("lists no fact when every expected fact is recorded", async () => {
    const met = aGuide({
      sections: [aSection({ coverage: { met: 1, of: 1, facts: [aFact({ state: "met" })] } })],
    });
    await openGuide("Editor", met);

    const section = within(sectionNamed(SECTION_ONE));
    expect(section.getByText("1 of 1 expected fact recorded")).toBeDefined();
    expect(section.queryByText(/not yet recorded/u)).toBeNull();
    expect(section.queryByText(/recorded but not in this section/u)).toBeNull();
    expect(section.queryByRole("link", { name: "Add This Fact" })).toBeNull();
  });

  it("names an available fact and offers Include to an Editor", async () => {
    const available = aGuide({
      sections: [aSection({ coverage: { met: 3, of: 4, facts: [aFact({ state: "available" })] } })],
    });
    await openGuide("Editor", available);

    const section = within(sectionNamed(SECTION_ONE));
    expect(
      section.getByText(`${LIABILITY_TITLE} is recorded but not in this section.`),
    ).toBeDefined();
    expect(section.getByRole("button", { name: "Include" })).toBeDefined();
    expect(section.queryByRole("link", { name: "Add This Fact" })).toBeNull();
  });

  it("offers no Include to a Viewer", async () => {
    const available = aGuide({
      sections: [
        aSection({
          brief: aViewersBrief(),
          coverage: { met: 3, of: 4, facts: [aFact({ state: "available" })] },
        }),
      ],
    });
    await openGuide("Viewer", available);

    expect(screen.getByText(/is recorded but not in this section/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
  });
});

describe("including an available fact", () => {
  const AVAILABLE = aGuide({
    coverage: { met: 3, of: 4 },
    sections: [
      aSection({
        number: "3",
        prompt: "Insurance",
        coverage: { met: 3, of: 4, facts: [aFact({ state: "available" })] },
      }),
    ],
  });

  const INCLUDED = aGuide({
    coverage: { met: 4, of: 4 },
    sections: [
      aSection({
        number: "3",
        prompt: "Insurance",
        coverage: { met: 4, of: 4, facts: [aFact({ state: "met" })] },
        brief: aBrief({
          detail: [
            { iri: RACKING_IRI, title: LIABILITY_TITLE, kind: "Policy", body: "Cover is £5m." },
          ],
        }),
      }),
    ],
  });

  it("announces the section and redraws it with the concept", async () => {
    const { api } = await openGuide("Editor", AVAILABLE);
    api.set(INCLUDE, () => {
      api.set("knowledge.guide", () => read(INCLUDED));
      return read({ included: 1 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Include" }));

    const status = await screen.findByText("Included in section 3.");
    expect(status.tagName).toBe("OUTPUT");
    await waitFor(() => {
      expect(screen.getAllByText("4 of 4 expected facts recorded")).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
    expect(asksOf(INCLUDE)).toEqual([{ writeUpId: A_WRITE_UP_ID }]);
    fireEvent.click(screen.getByRole("button", { name: "Show Detail" }));
    expect(await screen.findByText("Cover is £5m.")).toBeDefined();
  });

  it("says so when the include is refused", async () => {
    const { api } = await openGuide("Editor", AVAILABLE);
    api.set(INCLUDE, () => aRefusalAnswer("role-forbids", "forbidden", 403));

    fireEvent.click(screen.getByRole("button", { name: "Include" }));

    expect(await screen.findByText(/Only an Editor or an Admin/u)).toBeDefined();
    expect(screen.getByRole("button", { name: "Include" })).toBeDefined();
  });
});
