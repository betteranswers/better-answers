import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_WORDS } from "@/features/knowledge/editing/editor-words.ts";
import { SEARCH_WORDS } from "@/features/knowledge/knowledge-words.ts";
import {
  A_CONCEPT_IRI,
  A_CONCEPT_PAGE,
  aConceptToEdit,
  aNewConceptApi,
  asksOf,
  BLANK_TO_EDIT,
  committed,
  newConceptAt,
  savesAsked,
  suggested,
} from "@test/knowledge/concept-editing-answers.ts";
import { finding, openedSearch, placedForSearch, typed } from "@test/knowledge/search-answers.ts";
import { settlingAfter, type Api } from "@test/stubbed-api.ts";
import { read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/editing/concept-session.tsx");

placedForSearch();

beforeEach(() => {
  sessionStorage.clear();
});

const TO_EDIT = "knowledge.conceptToEdit";

const SAVE = "knowledge.saveConcept";

const NEW_CONCEPT_OFFER = SEARCH_WORDS.newConcept;

const leaveAsked = () => screen.queryByRole("button", { name: EDITOR_WORDS.leave });

const quietStatuses = () =>
  screen.getAllByRole("status").filter((each) => each.textContent.trim() === "");

const saveNamed = () =>
  screen
    .getAllByRole("button")
    .map((button) => button.textContent)
    .find((name) => name === EDITOR_WORDS.save || name === EDITOR_WORDS.sendSuggestion);

const savesAs = async (name: string) => {
  await waitFor(() => {
    expect(saveNamed()).toBe(name);
  });
};

const collectionsIn = (...names: readonly string[]) =>
  read({
    collections: names.map((collection) => ({
      collection,
      count: 1,
      kinds: [{ conceptType: "Policy", count: 1 }],
    })),
  });

const firstLate = (late: Promise<unknown>, afterwards: unknown) => {
  let reads = 0;
  return (): unknown => {
    reads += 1;
    return reads === 1 ? late : afterwards;
  };
};

const kindField = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: EDITOR_WORDS.conceptType });

const titleField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });

const collectionField = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: "Collection" });

const typedInto = (field: HTMLElement, value: string): void => {
  fireEvent.change(field, { target: { value } });
};

const chose = (collection: string): void => {
  typedInto(collectionField(), collection);
};

const pressed = (name: string): void => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const newConceptHeading = () =>
  screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew });

const newConceptClosed = () =>
  waitFor(() => {
    expect(screen.queryByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew })).toBeNull();
  });

const openedForANewConcept = async (fields: Readonly<Record<string, string>> = {}, api?: Api) => {
  const asked = api ?? aNewConceptApi();
  const router = await openedSearch(
    asked,
    newConceptAt({ new: "Cyber Essentials Plus certificate", subject: A_CONCEPT_IRI, ...fields }),
  );
  await newConceptHeading();
  return router;
};

const searchWithNoMatch = async (query: string, api: Api = aNewConceptApi()) => {
  api.set("knowledge.find", finding({}));
  await openedSearch(api, newConceptAt({ search: query }));
  return screen.findByRole("button", { name: NEW_CONCEPT_OFFER });
};

describe("typing a new concept from Search", () => {
  it("keeps the draft when a collection is chosen after typing", async () => {
    const api = aNewConceptApi();
    api.set(SAVE, committed);
    const router = await openedForANewConcept({}, api);

    typedInto(kindField(), "Policy");
    chose("policies");

    await savesAs(EDITOR_WORDS.save);
    expect(leaveAsked()).toBeNull();
    expect(kindField().value).toBe("Policy");
    expect(router.state.location.searchStr).toContain("knowledge.collection=policies");
    expect(
      screen.getByRole("button", { name: EDITOR_WORDS.save }).getAttribute("aria-disabled"),
    ).toBe("false");

    pressed(EDITOR_WORDS.save);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(A_CONCEPT_PAGE);
    });
    expect(savesAsked()).toHaveLength(1);
  });

  it("asks nothing when a typed form is closed", async () => {
    const router = await openedForANewConcept({ collection: "policies" });

    typedInto(kindField(), "Policy");
    pressed(EDITOR_WORDS.close);

    await newConceptClosed();
    expect(leaveAsked()).toBeNull();
    await waitFor(() => {
      expect(router.state.location.searchStr).not.toContain("knowledge.new");
    });
  });

  it("gives a closed draft back from the offer", async () => {
    const offer = await searchWithNoMatch("Cyber Essentials Plus certificate");
    fireEvent.click(offer);
    await newConceptHeading();
    typedInto(kindField(), "Certification");
    typedInto(titleField(), "Cyber Essentials Plus");

    pressed(EDITOR_WORDS.close);
    await newConceptClosed();
    fireEvent.click(await screen.findByRole("button", { name: NEW_CONCEPT_OFFER }));

    await newConceptHeading();
    expect(kindField().value).toBe("Certification");
    expect(titleField().value).toBe("Cyber Essentials Plus");
  });

  it("opens fresh for a search whose draft was saved", async () => {
    const api = aNewConceptApi("suggests");
    api.set(SAVE, suggested);
    api.set("knowledge.find", finding({}));
    const query = "Cyber Essentials Plus certificate";
    await openedSearch(
      api,
      newConceptAt({
        search: query,
        new: query,
        subject: A_CONCEPT_IRI,
        collection: "policies",
        kind: "Certification",
      }),
    );
    await newConceptHeading();
    typedInto(titleField(), "Cyber Essentials Plus");
    pressed(EDITOR_WORDS.sendSuggestion);
    await newConceptClosed();

    fireEvent.click(await screen.findByRole("button", { name: NEW_CONCEPT_OFFER }));

    await newConceptHeading();
    expect(titleField().value).toBe(query);
  });

  it("uses the live search text when the offer is pressed", async () => {
    const offer = await searchWithNoMatch("gift policy");

    typed("gift policy zz");
    fireEvent.click(offer);

    await newConceptHeading();
    expect(titleField().value).toBe("gift policy zz");
  });

  it("keeps the last collection's standing when reads answer late", async () => {
    const api = aNewConceptApi();
    api.set("knowledge.tree", () => collectionsIn("policies", "finance"));
    const lateRead = Promise.withResolvers<unknown>();
    api.set(TO_EDIT, firstLate(lateRead.promise, aConceptToEdit({ ...BLANK_TO_EDIT })));
    await openedForANewConcept({}, api);

    chose("policies");
    await waitFor(() => {
      expect(asksOf(TO_EDIT)).toHaveLength(1);
    });
    chose("finance");
    await savesAs(EDITOR_WORDS.save);
    await settlingAfter(() => {
      lateRead.resolve(aConceptToEdit({ ...BLANK_TO_EDIT, standing: "suggests" }));
    });

    expect(asksOf(TO_EDIT)).toHaveLength(2);
    expect(saveNamed(), "the late read changed the save's standing").toBe(EDITOR_WORDS.save);
  });

  it("reports a new concept's suggestion after its form closes", async () => {
    const api = aNewConceptApi("suggests");
    api.set(SAVE, suggested);
    await openedForANewConcept({ collection: "policies", kind: "Policy" }, api);

    await savesAs(EDITOR_WORDS.sendSuggestion);
    const quiet = quietStatuses();
    pressed(EDITOR_WORDS.sendSuggestion);

    await newConceptClosed();
    expect(savesAsked()).toHaveLength(1);
    expect(
      quiet.some((status) => /\S/u.test(status.textContent)),
      "no status reported the suggestion",
    ).toBe(true);
  });
});
