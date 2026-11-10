import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_WORDS, SAID_OF_EDITING } from "@/features/knowledge/editing/editor-words.ts";
import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import {
  A_CONCEPT_IRI,
  A_CONCEPT_PAGE,
  aConceptApi,
  aConceptToEdit,
  aNewConceptApi,
  asksOf,
  committed,
  newConceptAt,
  PARTS,
  savesAsked,
  suggested,
  unchanged,
  type Standing,
} from "@test/knowledge/concept-editing-answers.ts";
import {
  choseAType,
  conceptTypeShown,
  withATypePicker,
} from "@test/knowledge/concept-type-picker.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure, settlingAfter, type Api } from "@test/stubbed-api.ts";
import { aRefusalAnswer, GRACE, NORTHERN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/editing/concept-session.tsx");

placedWithoutMeasuring();

withATypePicker();

beforeEach(() => {
  sessionStorage.clear();
});

const TO_EDIT = "knowledge.conceptToEdit";

const SAVE = "knowledge.saveConcept";

const TREE = "knowledge.tree";

const USED_TWICE = { writeUps: 1, linkingConcepts: 1 };

const USED_THRICE = { writeUps: 2, linkingConcepts: 1 };

const LAUNCHERS: ReadonlySet<string> = new Set([EDITOR_WORDS.edit, EDITOR_WORDS.suggest]);

const HEADINGS: ReadonlySet<string> = new Set([
  EDITOR_WORDS.headingEdit,
  EDITOR_WORDS.headingSuggest,
]);

const editorOpened = async (api: Api) => {
  const router = await openAt(A_CONCEPT_PAGE, api);
  fireEvent.click(await screen.findByRole("button", { name: (name) => LAUNCHERS.has(name) }));
  await screen.findByRole("heading", { level: 3, name: (name) => HEADINGS.has(name) });
  return router;
};

const titleField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });

const bodyField = () => screen.getByRole("textbox", { name: "Body" });

const retitled = (title: string) => {
  fireEvent.change(titleField(), { target: { value: title } });
};

const pressed = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const wordsIn = (role: "status" | "alert") =>
  screen
    .queryAllByRole(role)
    .map((each) => each.textContent)
    .join("")
    .trim();

const warnings = () =>
  screen.queryAllByText("Warning").map((label) => label.parentElement?.textContent ?? "");

const describedBy = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

const editorClosed = async (heading: string) => {
  await waitFor(() => {
    expect(
      screen.queryByRole("heading", { level: 3, name: heading }),
      "the editor stayed open after the save",
    ).toBeNull();
  });
};

const buttonFor = async (standing: Standing) => {
  await openAt(A_CONCEPT_PAGE, aConceptApi(standing));
  const button = await screen.findByRole("button", { name: (name) => LAUNCHERS.has(name) });
  const name = button.textContent;
  cleanup();
  return name;
};

describe("editing a concept on its own page", () => {
  it("shows Edit to a committer, Suggest an Edit otherwise", async () => {
    expect(await buttonFor("commits")).toBe("Edit");
    expect(await buttonFor("suggests")).toBe(EDITOR_WORDS.suggest);
  });

  it("reads the concept to edit after the press", async () => {
    const api = aConceptApi("commits");
    await openAt(A_CONCEPT_PAGE, api);
    const button = await screen.findByRole("button", { name: "Edit" });
    expect(asksOf(TO_EDIT)).toHaveLength(0);
    expect(asksOf(TREE)).toHaveLength(0);

    fireEvent.click(button);
    await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingEdit });
    expect(asksOf(TO_EDIT)).toHaveLength(1);
    await waitFor(() => {
      expect(asksOf(TREE)).toHaveLength(1);
    });
  });

  it("opens the editor and switches mode with their keys", async () => {
    await openAt(A_CONCEPT_PAGE, aConceptApi("commits"));
    await screen.findByRole("button", { name: "Edit" });

    fireEvent.keyDown(document.body, { key: "e" });
    const heading = await screen.findByRole("heading", {
      level: 3,
      name: EDITOR_WORDS.headingEdit,
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getByRole("button", { name: "Visual" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.keyDown(document.body, { key: "m" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Markdown" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
    fireEvent.keyDown(document.body, { key: "m" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Visual" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });
  });

  it("asks once when the concept is used twice", async () => {
    const api = aConceptApi("commits", { usedIn: USED_TWICE });
    api.set(SAVE, committed);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.save);
    expect(await screen.findByRole("button", { name: EDITOR_WORDS.keepEditing })).toBeDefined();
    expect(warnings().some((warning) => warning.includes(EDITOR_WORDS.reuse(USED_TWICE)))).toBe(
      true,
    );
    expect(savesAsked()).toHaveLength(0);

    pressed(EDITOR_WORDS.save);
    await editorClosed(EDITOR_WORDS.headingEdit);
    expect(wordsIn("status")).toMatch(/\S/);
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed"]);
  });

  it("asks again when a place was added meanwhile", async () => {
    const api = aConceptApi("commits", { usedIn: USED_TWICE });
    api.set(SAVE, () => {
      api.set(TO_EDIT, () => aConceptToEdit({ usedIn: USED_THRICE }));
      api.set(SAVE, committed);
      return aRefusalAnswer("reuse-unconfirmed", "inapplicable", 422);
    });
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.save);
    screen.getByRole("button", { name: EDITOR_WORDS.save }).focus();
    pressed(EDITOR_WORDS.save);

    await waitFor(() => {
      expect(
        warnings().some((warning) => warning.includes(EDITOR_WORDS.reuse(USED_THRICE))),
        "the ask kept the old count of places",
      ).toBe(true);
    });
    const line = screen.getByText(SAID_OF_EDITING["reuse-unconfirmed"]);
    const question = screen.getByText(EDITOR_WORDS.warning);
    expect(
      line.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the places-changed line is not above the question",
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement, "focus fell to the page after the refusal").toBe(
        screen.getByRole("button", { name: EDITOR_WORDS.save }),
      );
    });
    pressed(EDITOR_WORDS.save);
    await editorClosed(EDITOR_WORDS.headingEdit);
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed", "confirmed"]);
  });

  it("warns what a save does, differently for a suggestion", async () => {
    await editorOpened(aConceptApi("commits"));
    expect(screen.queryByText(EDITOR_WORDS.suggests)).toBeNull();
    expect(screen.getByRole("button", { name: EDITOR_WORDS.save })).toBeDefined();
    cleanup();

    await editorOpened(aConceptApi("suggests"));
    expect(screen.getByText(EDITOR_WORDS.suggests)).toBeDefined();
    expect(screen.getByRole("button", { name: EDITOR_WORDS.sendSuggestion })).toBeDefined();
  });

  it("opens a table body as markdown and disables Visual", async () => {
    const body = "| Year | Kept |\n| --- | --- |\n| 2026 | Yes |";
    await editorOpened(aConceptApi("commits", { parts: { ...PARTS, body } }));

    expect(screen.getByRole("button", { name: "Markdown" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Visual" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("explains the body only when it opens as markdown", async () => {
    await editorOpened(aConceptApi("commits"));
    expect(bodyField().getAttribute("aria-describedby")).toBeNull();
    cleanup();

    const body = "| Year | Kept |\n| --- | --- |\n| 2026 | Yes |";
    await editorOpened(aConceptApi("commits", { parts: { ...PARTS, body } }));
    await waitFor(() => {
      expect(describedBy(bodyField()), "the body has no reason for opening as markdown").toMatch(
        /\S/,
      );
    });
  });

  it("numbers a source after a hidden one by its place", async () => {
    await editorOpened(
      aConceptApi("commits", {
        sources: ["Audit handbook", "Calder handbook"],
        withheld: [{ at: 0, label: "Restricted board minutes" }],
      }),
    );

    expect(screen.queryByRole("textbox", { name: "Source 1" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Source 2" }).closest("li")?.value).toBe(2);
    expect(screen.getByRole("textbox", { name: "Source 3" }).closest("li")?.value).toBe(3);
    expect(screen.getByRole("button", { name: "Remove source 2" })).toBeDefined();
  });

  it("numbers sources around a hidden one in the middle", async () => {
    await editorOpened(
      aConceptApi("commits", {
        sources: ["Audit handbook", "Calder handbook"],
        withheld: [{ at: 1, label: "Restricted board minutes" }],
      }),
    );

    expect(screen.getByRole("textbox", { name: "Source 1" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Source 3" })).toBeDefined();
    pressed(EDITOR_WORDS.addSource);
    expect(screen.getByRole("textbox", { name: "Source 4" })).toBeDefined();
  });

  it("reports saving while the server works, then closes", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, committed);
    const held = holdProcedure(api, SAVE);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.save);
    expect(wordsIn("status"), "the status said nothing while saving").toMatch(/\S/);
    expect(
      screen.getByRole("button", { name: EDITOR_WORDS.save }).getAttribute("aria-disabled"),
    ).toBe("true");

    await held.asked;
    held.resolve();
    await editorClosed(EDITOR_WORDS.headingEdit);
    expect(wordsIn("status")).toMatch(/\S/);
  });

  it("keeps the editor open when the server finds no change", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, unchanged);
    await editorOpened(api);

    pressed(EDITOR_WORDS.save);

    await waitFor(() => {
      expect(wordsIn("status"), "the status said nothing of the unchanged save").toMatch(/\S/);
    });
    expect(screen.getByRole("heading", { level: 3, name: EDITOR_WORDS.headingEdit })).toBeDefined();
  });

  it("reports a sent suggestion and closes the editor", async () => {
    const api = aConceptApi("suggests");
    api.set(SAVE, suggested);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.sendSuggestion);

    await editorClosed(EDITOR_WORDS.headingSuggest);
    expect(wordsIn("status"), "the status said nothing of the suggestion").toMatch(/\S/);
  });

  it("offers a reload when the concept changed after it opened", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, () => aRefusalAnswer("stale-precondition", "conflict", 409));
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.save);

    expect(await screen.findByRole("button", { name: EDITOR_WORDS.reload })).toBeDefined();
    expect(wordsIn("status")).toMatch(/\S/);
    api.set(TO_EDIT, () => aConceptToEdit({ base: "second-base" }));
    pressed(EDITOR_WORDS.reload);

    await waitFor(() => {
      expect(titleField().value).toBe("Audit Logs Retention");
    });
    expect(asksOf(TO_EDIT)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: EDITOR_WORDS.reload })).toBeNull();
    expect(wordsIn("status"), "the stale notice outlived the reload").toBe("");
  });

  it("keeps the draft while an earlier change is still saving", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, () => aRefusalAnswer("unrecorded-head", "precondition", 412));
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.save);

    await waitFor(() => {
      expect(wordsIn("alert"), "the refused save raised no alert").toMatch(/\S/);
    });
    expect(titleField().value).toBe("Audit Log Retention");
  });

  it("refuses to save an empty body and sends nothing", async () => {
    const api = aConceptApi("commits", { parts: { ...PARTS, body: "" } });
    api.set(SAVE, committed);
    await editorOpened(api);

    const save = screen.getByRole("button", { name: EDITOR_WORDS.save });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(save), "the disabled Save gives no reason").toMatch(/\S/);

    await settlingAfter(() => {
      fireEvent.click(save);
    });
    expect(savesAsked()).toHaveLength(0);
  });

  it("moves focus to the Edit as button on Escape", async () => {
    await editorOpened(aConceptApi("commits"));

    titleField().focus();
    fireEvent.keyDown(titleField(), { key: "Escape" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Visual" }));
  });

  it("saves from a field with Control and Enter", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, committed);
    await editorOpened(api);

    fireEvent.keyDown(titleField(), { key: "Enter", ctrlKey: true });

    await editorClosed(EDITOR_WORDS.headingEdit);
    expect(savesAsked()).toHaveLength(1);
  });

  it("keeps the draft when the editor closes and reopens", async () => {
    const api = aConceptApi("commits");
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.close);
    expect(screen.queryByRole("heading", { level: 3, name: EDITOR_WORDS.headingEdit })).toBeNull();
    expect(wordsIn("status")).toContain(EDITOR_WORDS.kept);

    pressed("Edit");
    await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingEdit });
    expect(titleField().value).toBe("Audit Log Retention");
  });

  it("gives a person's draft to no one else", async () => {
    await editorOpened(aConceptApi("commits"));
    retitled("Audit Log Retention");
    pressed(EDITOR_WORDS.close);
    cleanup();

    const api = aConceptApi("commits");
    api.set("session.member", () =>
      read({
        workspace: NORTHERN,
        person: { id: GRACE.personId, name: GRACE.displayName, email: GRACE.address },
        role: "Admin",
        owns: { collections: [], concepts: 0 },
      }),
    );
    await editorOpened(api);

    expect(titleField().value).toBe(PARTS.title);
  });

  it("asks before leaving with unsaved changes", async () => {
    const router = await editorOpened(aConceptApi("commits"));

    retitled("Audit Log Retention");
    act(() => {
      void router.navigate({ href: SEARCH_PAGE.path });
    });
    expect(await screen.findByRole("button", { name: EDITOR_WORDS.leave })).toBeDefined();
    expect(router.state.location.pathname).toBe(A_CONCEPT_PAGE);

    pressed(EDITOR_WORDS.keepEditing);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: EDITOR_WORDS.leave })).toBeNull();
    });

    act(() => {
      void router.navigate({ href: SEARCH_PAGE.path });
    });
    fireEvent.click(await screen.findByRole("button", { name: EDITOR_WORDS.leave }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
    });
  });

  it("sends the edited sources and keeps the hidden one", async () => {
    const api = aConceptApi("commits", {
      sources: ["Retention policy", "Audit handbook"],
      withheld: [{ at: 1, label: "Restricted board minutes" }],
    });
    api.set(SAVE, committed);
    await editorOpened(api);

    expect(screen.queryByText(/Restricted board minutes/u)).toBeNull();
    pressed("Remove source 1");
    pressed(EDITOR_WORDS.addSource);
    fireEvent.change(screen.getByRole("textbox", { name: "Source 3" }), {
      target: { value: "Calder handbook" },
    });
    pressed(EDITOR_WORDS.save);

    await editorClosed(EDITOR_WORDS.headingEdit);
    const [asked] = savesAsked();
    expect(asked?.sources).toEqual(["Audit handbook", "Calder handbook"]);
    expect(asked?.withheld).toEqual([1]);
  });

  it("opens prefilled from the address", async () => {
    const api = aNewConceptApi();
    const address = newConceptAt({
      new: "Cyber Essentials Plus certificate",
      collection: "policies",
      type: "certification",
      tags: "cyber-essentials",
      subject: A_CONCEPT_IRI,
    });
    await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew });
    expect(titleField().value).toBe("Cyber Essentials Plus certificate");
    expect(conceptTypeShown()).toBe("certification");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tags" }).value).toBe(
      "cyber-essentials",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Collection" }).value).toBe(
      "policies",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain(
      "Audit Logs Retention",
    );
    expect(await screen.findByRole("button", { name: EDITOR_WORDS.save })).toBeDefined();
  });

  it("commits a new concept and opens its page", async () => {
    const api = aNewConceptApi();
    api.set(SAVE, committed);
    const address = newConceptAt({
      new: "Cyber Essentials Plus certificate",
      subject: A_CONCEPT_IRI,
    });
    const router = await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew });
    const save = screen.getByRole("button", { name: EDITOR_WORDS.save });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(save), "the disabled Save gives no reason").toMatch(/\S/);

    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), {
      target: { value: "policies" },
    });
    await screen.findByRole("button", { name: EDITOR_WORDS.save });
    await choseAType("Policy");
    pressed(EDITOR_WORDS.save);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(A_CONCEPT_PAGE);
    });
    expect(router.state.location.searchStr).not.toContain("knowledge.new");
  });

  it("keeps a new concept's suggestion notice after its form closes", async () => {
    const api = aNewConceptApi();
    api.set(SAVE, suggested);
    const address = newConceptAt({
      new: "Cyber Essentials Plus certificate",
      collection: "policies",
      type: "Policy",
      subject: A_CONCEPT_IRI,
    });
    const router = await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew });
    await screen.findByRole("button", { name: EDITOR_WORDS.save });
    const quiet = screen
      .getAllByRole("status")
      .filter((status) => status.textContent.trim() === "");
    pressed(EDITOR_WORDS.save);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 3, name: EDITOR_WORDS.headingNew })).toBeNull();
    });
    expect(
      quiet.some((status) => /\S/u.test(status.textContent)),
      "the suggestion notice closed with its form",
    ).toBe(true);
    expect(router.state.location.searchStr).not.toContain("knowledge.new");
  });
});
