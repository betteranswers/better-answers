import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";
import { detailAt } from "@/shared/navigation.ts";
import { clipboardAnswering } from "@test/clipboard-stand-in.ts";
import { aConceptIri, anIssuedConcept } from "@test/knowledge/search-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, aRefusalAnswer, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_CONCEPT = detailAt(SEARCH_PAGE, "01JRETENTN000000000000000A");

type Opened = Parameters<typeof anIssuedConcept>[0];

const opened = async (changes: Opened = {}) => {
  const api = adaAnAdmin();
  api.set("knowledge.open", () => read({ found: true, concept: anIssuedConcept(changes) }));
  await openAt(A_CONCEPT, api);
  return within(await screen.findByRole("article"));
};

const SOURCES = [
  { source: "SCP tender 2025.pdf", at: "p.4" },
  { source: "Working Together to Safeguard Children 2023", at: "ch.2" },
];

describe("the concept page", () => {
  it("shows not found when the api rejects the id", async () => {
    const api = adaAnAdmin();
    api.set("knowledge.open", () => aRefusalAnswer("malformed", "invalid", 400));
    await openAt(A_CONCEPT, api);

    const main = within(screen.getByRole("main"));
    expect(await main.findByRole("link", { name: "Back to Search" })).toBeDefined();
    expect(screen.queryByRole("article")).toBeNull();
    expect(main.queryAllByRole("alert")).toHaveLength(0);
    expect(main.queryAllByRole("status").filter((each) => each.textContent !== "")).toHaveLength(0);
  });

  it("draws the title block, not details from the file", async () => {
    const article = await opened();

    const block = within(article.getByRole("complementary", { name: "About this concept" }));
    expect(block.getByText("Verified by Priya Shah · 3 March 2026")).toBeDefined();
    expect(block.getByText("Owner of Sectors")).toBeDefined();
    expect(article.queryByText(/details from the file/iu)).toBeNull();
    expect(article.queryByRole("region", { name: "Verification" })).toBeNull();
  });

  it("holds the one title in the page's own column", async () => {
    const article = await opened();

    expect(article.getByRole("heading", { level: 1 }).textContent).toBe(
      "Safeguarding Children Partnerships",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("names the kind and collection, or no collection", async () => {
    const article = await opened({ collection: null });

    expect(article.getByText(CONCEPT_WORDS.kind).nextElementSibling?.textContent).toBe("Sector");
    expect(article.getByText("Collection").nextElementSibling?.textContent).toBe("No collection");
  });
});

describe("the sources of the concept page", () => {
  it("draws no Sources heading when the concept cites nothing", async () => {
    const article = await opened({ evidence: [] });

    expect(article.queryByRole("heading", { name: /Sources/u })).toBeNull();
  });

  it("lists each source with its number and place", async () => {
    const article = await opened({ evidence: SOURCES });

    const sources = article.getByRole("region", { name: /Sources/u });
    expect(within(sources).getByRole("heading", { name: "Sources 2" })).toBeDefined();
    expect(
      within(sources)
        .getAllByRole("listitem")
        .map((line) => line.textContent),
    ).toEqual(["[1]SCP tender 2025.pdfp.4", "[2]Working Together to Safeguard Children 2023ch.2"]);
  });

  it("shows no access line when every source is included", async () => {
    const included = await opened({ evidence: SOURCES, lead: "All of it is yours to read." });
    expect(included.queryByText("All of it is yours to read.")).toBeNull();
  });

  it("explains when some sources are withheld", async () => {
    const article = await opened({
      evidence: SOURCES,
      access: "partly-included",
      lead: "Some sources are not included.",
      next: "Ask an Admin for access to the sources.",
    });

    expect(article.getByText("Some sources are not included.")).toBeDefined();
    expect(article.getByText("Ask an Admin for access to the sources.")).toBeDefined();
  });
});

describe("the links of the concept page", () => {
  it("draws no Links heading when nothing is linked", async () => {
    const article = await opened({ relations: [] });

    expect(article.queryByRole("heading", { name: /Links/u })).toBeNull();
  });

  it("lists each link with the title it leads to", async () => {
    const article = await opened({
      relations: [
        {
          kind: "REFERENCES",
          target: aConceptIri("https://better-answers.com/c/01JRETENTN000000000000000B"),
          title: "Section 11 audit",
        },
      ],
    });

    const links = article.getByRole("region", { name: /Links/u });
    expect(within(links).getByRole("link", { name: "Section 11 audit" })).toBeDefined();
    expect(within(links).getByRole("heading", { name: "Links 1" })).toBeDefined();
  });
});

describe("copying the concept", () => {
  it("copies the body and says it is copied", async () => {
    const written = clipboardAnswering(() => Promise.resolve());
    const article = await opened({ body: "Audit logs are kept for six years." });

    fireEvent.click(article.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(article.getByText("Copied")).toBeDefined());
    expect(written).toEqual(["Audit logs are kept for six years."]);
    expect(article.getByText("Copied").getAttribute("aria-live")).toBe("polite");
  });

  it("says when the browser would not copy", async () => {
    clipboardAnswering(() => Promise.reject(new Error("refused")));
    const article = await opened();

    fireEvent.click(article.getByRole("button", { name: "Copy" }));

    expect(await article.findByText(/Couldn't copy/u)).toBeDefined();
    expect(article.queryByText("Copied")).toBeNull();
  });
});
