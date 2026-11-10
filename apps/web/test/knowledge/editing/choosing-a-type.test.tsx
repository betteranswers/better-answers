import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EDITOR_WORDS } from "@/features/knowledge/editing/editor-words.ts";
import {
  A_CONCEPT_PAGE,
  aConceptApi,
  aTreeOfTypes,
  committed,
  PARTS,
  savesAsked,
  suggested,
  WORKSPACE_TYPES,
} from "@test/knowledge/concept-editing-answers.ts";
import {
  addedAType,
  choseAType,
  conceptTypeField,
  conceptTypeSearch,
  conceptTypeShown,
  optionNames,
  searchedTypesFor,
  withATypePicker,
} from "@test/knowledge/concept-type-picker.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import type { Api } from "@test/stubbed-api.ts";
import { openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/editing/concept-session.tsx");

placedWithoutMeasuring();

withATypePicker();

const SAVE = "knowledge.saveConcept";

const LAUNCHERS: ReadonlySet<string> = new Set([EDITOR_WORDS.edit, EDITOR_WORDS.suggest]);

const HEADINGS: ReadonlySet<string> = new Set([
  EDITOR_WORDS.headingEdit,
  EDITOR_WORDS.headingSuggest,
]);

const held = (...conceptTypes: readonly string[]) =>
  conceptTypes.map((conceptType) => ({ conceptType, count: 1 }));

const editorOpened = async (api: Api = aConceptApi("commits"), saving = committed) => {
  api.set(SAVE, saving);
  await openAt(A_CONCEPT_PAGE, api);
  fireEvent.click(await screen.findByRole("button", { name: (name) => LAUNCHERS.has(name) }));
  await screen.findByRole("heading", { level: 3, name: (name) => HEADINGS.has(name) });
};

const savedAs = async (conceptType: string) => {
  fireEvent.click(screen.getByRole("button", { name: EDITOR_WORDS.save }));
  await waitFor(() => {
    expect(savesAsked()).toHaveLength(1);
  });
  expect(savesAsked().map((asked) => asked.parts.conceptType)).toEqual([conceptType]);
};

describe("the concept type field", () => {
  it("offers every type in the workspace beside the concept's own", async () => {
    await editorOpened();

    expect(conceptTypeShown()).toBe(PARTS.conceptType);
    fireEvent.click(conceptTypeField());

    expect(await screen.findByRole("listbox", { name: EDITOR_WORDS.conceptTypes })).toBeDefined();
    expect(await optionNames()).toEqual(WORKSPACE_TYPES);
  });

  it("offers each type once when two collections hold it", async () => {
    const api = aConceptApi("commits");
    api.set("knowledge.tree", () =>
      read({
        collections: [
          { collection: "policies", count: 2, conceptTypes: held("Policy", "Sector") },
          { collection: "handbook", count: 2, conceptTypes: held("Policy", "Answer") },
        ],
      }),
    );
    await editorOpened(api);

    fireEvent.click(conceptTypeField());
    await screen.findByRole("listbox");

    expect(await optionNames()).toEqual(["Answer", "Policy", "Sector"]);
  });

  it("saves the type that was chosen from the list", async () => {
    await editorOpened();

    await choseAType("Procedure");

    expect(conceptTypeShown()).toBe("Procedure");
    expect(screen.queryByRole("listbox")).toBeNull();
    await savedAs("Procedure");
  });

  it("sends a suggestion with the type as typed", async () => {
    const api = aConceptApi("suggests");
    await editorOpened(api, suggested);

    await addedAType("Risk Register");
    fireEvent.click(screen.getByRole("button", { name: EDITOR_WORDS.sendSuggestion }));

    await waitFor(() => {
      expect(savesAsked()).toHaveLength(1);
    });
    expect(savesAsked().map((asked) => asked.parts.conceptType)).toEqual(["Risk Register"]);
  });

  it("narrows the list as a name is typed", async () => {
    await editorOpened();

    await searchedTypesFor("pro");

    expect(await optionNames()).toEqual(["Procedure", EDITOR_WORDS.addConceptType("pro")]);
  });

  it("saves a type the workspace lacks as typed", async () => {
    await editorOpened();

    await addedAType("Risk Register");

    expect(conceptTypeShown()).toBe("Risk Register");
    await savedAs("Risk Register");
  });

  it("offers no new type for a name already listed", async () => {
    await editorOpened();

    await searchedTypesFor("sector");

    expect(await optionNames()).toEqual(["Sector"]);
  });

  it("says so when the workspace has no types yet", async () => {
    const api = aConceptApi("commits");
    api.set("knowledge.tree", () => aTreeOfTypes([]));
    await editorOpened(api);

    fireEvent.click(conceptTypeField());

    expect(await screen.findByText(EDITOR_WORDS.noConceptTypes)).toBeDefined();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("takes a typed type when the types can't be read", async () => {
    const api = aConceptApi("commits");
    api.delete("knowledge.tree");
    await editorOpened(api);

    await searchedTypesFor("Risk Register");

    expect(screen.queryByText(EDITOR_WORDS.noConceptTypes)).toBeNull();
    expect(await optionNames()).toEqual([EDITOR_WORDS.addConceptType("Risk Register")]);
    fireEvent.click(screen.getByRole("option"));
    await savedAs("Risk Register");
  });

  it("is chosen from the keyboard alone", async () => {
    await editorOpened();
    const user = userEvent.setup();

    conceptTypeField().focus();
    await user.keyboard("{Enter}");
    await user.type(conceptTypeSearch(), "proc");
    await user.keyboard("{Enter}");

    expect(conceptTypeShown()).toBe("Procedure");
    await waitFor(() => {
      expect(document.activeElement).toBe(conceptTypeField());
    });
  });

  it("closes on Escape and keeps the editor open", async () => {
    await editorOpened();
    const user = userEvent.setup();

    fireEvent.click(conceptTypeField());
    await user.type(conceptTypeSearch(), "{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(conceptTypeField());
    });
    expect(screen.getByRole("heading", { level: 3, name: EDITOR_WORDS.headingEdit })).toBeDefined();
  });
});
