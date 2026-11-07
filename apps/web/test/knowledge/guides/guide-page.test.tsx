import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GUIDES_PAGE } from "@/features/knowledge/guides/guide-state.ts";
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
  await screen.findByRole("heading", { level: 1, name: "Northgate Ltd" });
  return { api, router };
};

const sectionNamed = (name: string) => screen.getByRole("region", { name });

const guideArticle = () => within(screen.getByRole("article"));

const status = () => guideArticle().getByRole("status");

const alert = () => guideArticle().getByRole("alert");

const describedBy = (control: HTMLElement): string =>
  document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

const reasonBeside = (section: HTMLElement): string =>
  within(section).getByText("Needs review").nextElementSibling?.textContent ?? "";

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
    expect(article.getAllByText(/\b3 of 4\b/u)).toHaveLength(2);
  });

  it("names only Guides as current in the menu", async () => {
    await openGuide("Editor");

    const menu = screen.getByRole("navigation", { name: "Knowledge" });
    expect(
      within(menu)
        .getAllByRole("link", { current: "page" })
        .map((link) => link.textContent),
    ).toEqual([GUIDES_PAGE.name]);
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
    expect(screen.getByRole("heading", { name: "2.1. Cover" }).tagName).toBe("H3");
  });

  it("draws the trust word of each section as text", async () => {
    await openGuide(
      "Viewer",
      aGuide({
        sections: [
          aSection({
            trust: { tier: "human-reviewed", status: "current" },
            trustWords: "Verified by Dana",
          }),
        ],
      }),
    );

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

  it("offers Edit Brief but no Copy for an empty Brief", async () => {
    const empty = aBrief({ rendered: { markdown: "", footnotes: [] } });
    await openGuide("Editor", aGuide({ sections: [aSection({ brief: empty })] }));

    const section = within(sectionNamed(SECTION_ONE));
    expect(section.getByRole("button", { name: "Edit Brief" })).toBeDefined();
    expect(section.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(section.queryByRole("list", { name: "Footnotes" })).toBeNull();
  });

  it("offers a way back to Guides for an unknown guide", async () => {
    const api = aGuideApi("Editor");
    api.set("knowledge.guide", () => aRefusalAnswer("not-found", "absent", 404));
    await openAt(A_GUIDE_PAGE, api);

    const main = within(screen.getByRole("main"));
    const back = await main.findByRole("link", { name: "Back to Guides" });
    expect(back.getAttribute("href")).toBe(GUIDES_PAGE.path);
    expect(screen.queryByRole("article"), "the page drew a guide that was not found").toBeNull();
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
    expect(section.getByText(/\b2 of 4\b/u)).toBeDefined();
    expect(section.queryByRole("list", { name: "Footnotes" })).toBeNull();
    expect(section.queryByRole("button")).toBeNull();
    expect(section.queryByText(RACKING_TITLE)).toBeNull();
    expect(screen.queryByText("Each bay is racked by row.")).toBeNull();
  });

  it("still marks it as needing review, with a reason", async () => {
    await openGuide("Viewer", withheld);

    expect(reasonBeside(sectionNamed("3. Insurance"))).toMatch(/\S/u);
  });
});

describe("a section that needs review", () => {
  const REASONS = [
    "concept-changed",
    "concept-removed",
    "expectation-unmet",
    "review-finding",
  ] as const;

  it("gives a different reason for each kind of review", async () => {
    const given = new Set<string>();
    for (const reason of REASONS) {
      await openGuide("Viewer", aGuide({ sections: [aSection({ needsReview: reason })] }));
      const words = reasonBeside(sectionNamed(SECTION_ONE));
      expect(words, `the ${reason} review gave no reason`).toMatch(/\S/u);
      given.add(words);
      cleanup();
    }

    expect(given.size, "two kinds of review gave the same reason").toBe(REASONS.length);
  });

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

  it("returns focus to Show Detail when d closes it", async () => {
    await openGuide("Viewer");
    const button = screen.getByRole("button", { name: "Show Detail" });

    fireEvent.click(button);
    const detail = await screen.findByRole("region", { name: "Detail of section 1" });
    await waitFor(() => {
      expect(document.activeElement).toBe(detail);
    });
    fireEvent.keyDown(detail, { key: "d" });

    expect(screen.queryByRole("region", { name: "Detail of section 1" })).toBeNull();
    expect(document.activeElement).toBe(button);
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

    await waitFor(() => {
      expect(status().textContent, "d with no section in focus said nothing").toMatch(/\S/u);
    });
    expect(screen.queryByRole("region", { name: "Detail of section 1" })).toBeNull();
  });
});

describe("the coverage of a section", () => {
  it("names a missing fact, its owner and Add This Fact", async () => {
    await openGuide("Editor");

    const section = within(sectionNamed(SECTION_ONE));
    expect(section.getByText(/\b3 of 4\b/u)).toBeDefined();
    const add = section.getByRole("link", { name: "Add This Fact" });
    expect(describedBy(add)).toContain(LIABILITY_TITLE);
    expect(describedBy(add)).toContain("Dana Example");
  });

  it("names no owner for a fact in an unowned collection", async () => {
    await openGuide("Viewer", aGuide({ owner: null }));

    const add = screen.getByRole("link", { name: "Add This Fact" });
    expect(describedBy(add)).toContain(LIABILITY_TITLE);
    expect(describedBy(add), "the line named an owner the collection lacks").not.toContain(
      "Dana Example",
    );
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
    expect(section.getByText(/\b1 of 1\b/u)).toBeDefined();
    expect(sectionNamed(SECTION_ONE).textContent).not.toContain(LIABILITY_TITLE);
    expect(section.queryByRole("button", { name: "Include" })).toBeNull();
    expect(section.queryByRole("link", { name: "Add This Fact" })).toBeNull();
  });

  it("names an available fact and offers Include to an Editor", async () => {
    const available = aGuide({
      sections: [aSection({ coverage: { met: 3, of: 4, facts: [aFact({ state: "available" })] } })],
    });
    await openGuide("Editor", available);

    const section = within(sectionNamed(SECTION_ONE));
    expect(describedBy(section.getByRole("button", { name: "Include" }))).toContain(
      LIABILITY_TITLE,
    );
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

    expect(sectionNamed(SECTION_ONE).textContent).toContain(LIABILITY_TITLE);
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

    await waitFor(() => {
      expect(status().textContent, "the include was not announced").toMatch(/\S/u);
    });
    await waitFor(() => {
      expect(screen.getAllByText(/\b4 of 4\b/u)).toHaveLength(2);
    });
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
    expect(asksOf(INCLUDE)).toEqual([{ writeUpId: A_WRITE_UP_ID }]);
    fireEvent.click(screen.getByRole("button", { name: "Show Detail" }));
    expect(await screen.findByText("Cover is £5m.")).toBeDefined();
  });

  it("alerts and keeps Include when the include is refused", async () => {
    const { api } = await openGuide("Editor", AVAILABLE);
    api.set(INCLUDE, () => aRefusalAnswer("role-forbids", "forbidden", 403));

    fireEvent.click(screen.getByRole("button", { name: "Include" }));

    await waitFor(() => {
      expect(alert().textContent, "the refused include raised no alert").toMatch(/\S/u);
    });
    expect(screen.getByRole("button", { name: "Include" })).toBeDefined();
  });
});
