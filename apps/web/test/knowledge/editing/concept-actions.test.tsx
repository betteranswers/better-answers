import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure, settlingAfter, type Api } from "@test/stubbed-api.ts";
import { aRefusalAnswer, GRACE, NORTHERN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/editing/concept-session.tsx");

placedWithoutMeasuring();

beforeEach(() => {
  sessionStorage.clear();
});

const TO_EDIT = "knowledge.conceptToEdit";

const SAVE = "knowledge.saveConcept";

const editorOpened = async (api: Api) => {
  const router = await openAt(A_CONCEPT_PAGE, api);
  fireEvent.click(await screen.findByRole("button", { name: /^(Edit|Suggest an Edit)$/u }));
  await screen.findByRole("heading", { level: 3, name: /^(Edit This Concept|Suggest an Edit)$/u });
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
  const button = await screen.findByRole("button", { name: /^(Edit|Suggest an Edit)$/u });
  const name = button.textContent;
  cleanup();
  return name;
};

describe("editing a concept on its own page", () => {
  it("shows Edit to a committer, Suggest an Edit otherwise", async () => {
    expect(await buttonFor("commits")).toBe("Edit");
    expect(await buttonFor("suggests")).toBe("Suggest an Edit");
  });

  it("reads the concept to edit after the press", async () => {
    const api = aConceptApi("commits");
    await openAt(A_CONCEPT_PAGE, api);
    const button = await screen.findByRole("button", { name: "Edit" });
    expect(asksOf(TO_EDIT)).toHaveLength(0);

    fireEvent.click(button);
    await screen.findByRole("heading", { level: 3, name: "Edit This Concept" });
    expect(asksOf(TO_EDIT)).toHaveLength(1);
    expect(asksOf("knowledge.tree")).toHaveLength(0);
  });

  it("opens the editor and switches mode with their keys", async () => {
    await openAt(A_CONCEPT_PAGE, aConceptApi("commits"));
    await screen.findByRole("button", { name: "Edit" });

    fireEvent.keyDown(document.body, { key: "e" });
    const heading = await screen.findByRole("heading", { level: 3, name: "Edit This Concept" });
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
    const api = aConceptApi("commits", { usedIn: 2 });
    api.set(SAVE, committed);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");
    expect(await screen.findByRole("button", { name: "Keep Editing" })).toBeDefined();
    expect(warnings().some((warning) => /\b2\b/u.test(warning))).toBe(true);
    expect(savesAsked()).toHaveLength(0);

    pressed("Save");
    await editorClosed("Edit This Concept");
    expect(wordsIn("status")).toMatch(/\S/);
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed"]);
  });

  it("asks again when a place was added meanwhile", async () => {
    const api = aConceptApi("commits", { usedIn: 2 });
    api.set(SAVE, () => {
      api.set(TO_EDIT, () => aConceptToEdit({ usedIn: 3 }));
      api.set(SAVE, committed);
      return aRefusalAnswer("reuse-unconfirmed", "inapplicable", 422);
    });
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");
    pressed("Save");

    await waitFor(() => {
      expect(
        warnings().some((warning) => /\b3\b/u.test(warning)),
        "the ask kept the old count of places",
      ).toBe(true);
    });
    pressed("Save");
    await editorClosed("Edit This Concept");
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed", "confirmed"]);
  });

  it("warns what a save does, differently for a suggestion", async () => {
    await editorOpened(aConceptApi("commits"));
    const [commits] = warnings();
    cleanup();

    await editorOpened(aConceptApi("suggests"));
    const [suggests] = warnings();
    expect(commits, "the editor showed no warning before saving").toMatch(/\S/);
    expect(suggests, "a suggestion is warned of as if it commits").not.toBe(commits);
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
    pressed("Add a Source");
    expect(screen.getByRole("textbox", { name: "Source 4" })).toBeDefined();
  });

  it("reports saving while the server works, then closes", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, committed);
    const held = holdProcedure(api, SAVE);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");
    expect(wordsIn("status"), "the status said nothing while saving").toMatch(/\S/);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");

    await held.asked;
    held.resolve();
    await editorClosed("Edit This Concept");
    expect(wordsIn("status")).toMatch(/\S/);
  });

  it("keeps the editor open when the server finds no change", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, unchanged);
    await editorOpened(api);

    pressed("Save");

    await waitFor(() => {
      expect(wordsIn("status"), "the status said nothing of the unchanged save").toMatch(/\S/);
    });
    expect(screen.getByRole("heading", { level: 3, name: "Edit This Concept" })).toBeDefined();
  });

  it("reports a sent suggestion and closes the editor", async () => {
    const api = aConceptApi("suggests");
    api.set(SAVE, suggested);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");

    await editorClosed("Suggest an Edit");
    expect(wordsIn("status"), "the status said nothing of the suggestion").toMatch(/\S/);
  });

  it("offers a reload when the concept changed after it opened", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, () => aRefusalAnswer("stale-precondition", "conflict", 409));
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");

    expect(await screen.findByRole("button", { name: "Reload the Concept" })).toBeDefined();
    expect(wordsIn("status")).toMatch(/\S/);
    api.set(TO_EDIT, () => aConceptToEdit({ base: "second-base" }));
    pressed("Reload the Concept");

    await waitFor(() => {
      expect(titleField().value).toBe("Audit Logs Retention");
    });
    expect(asksOf(TO_EDIT)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Reload the Concept" })).toBeNull();
    expect(wordsIn("status"), "the stale notice outlived the reload").toBe("");
  });

  it("keeps the draft while an earlier change is still saving", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, () => aRefusalAnswer("unrecorded-head", "precondition", 412));
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");

    await waitFor(() => {
      expect(wordsIn("alert"), "the refused save raised no alert").toMatch(/\S/);
    });
    expect(titleField().value).toBe("Audit Log Retention");
  });

  it("refuses to save an empty body and sends nothing", async () => {
    const api = aConceptApi("commits", { parts: { ...PARTS, body: "" } });
    api.set(SAVE, committed);
    await editorOpened(api);

    const save = screen.getByRole("button", { name: "Save" });
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

    await editorClosed("Edit This Concept");
    expect(savesAsked()).toHaveLength(1);
  });

  it("keeps the draft when the editor closes and reopens", async () => {
    const api = aConceptApi("commits");
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Close Editor");
    expect(screen.queryByRole("heading", { level: 3, name: "Edit This Concept" })).toBeNull();

    pressed("Edit");
    await screen.findByRole("heading", { level: 3, name: "Edit This Concept" });
    expect(titleField().value).toBe("Audit Log Retention");
  });

  it("gives a person's draft to no one else", async () => {
    await editorOpened(aConceptApi("commits"));
    retitled("Audit Log Retention");
    pressed("Close Editor");
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
    expect(await screen.findByRole("button", { name: "Leave" })).toBeDefined();
    expect(router.state.location.pathname).toBe(A_CONCEPT_PAGE);

    pressed("Keep Editing");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
    });

    act(() => {
      void router.navigate({ href: SEARCH_PAGE.path });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
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
    pressed("Add a Source");
    fireEvent.change(screen.getByRole("textbox", { name: "Source 3" }), {
      target: { value: "Calder handbook" },
    });
    pressed("Save");

    await editorClosed("Edit This Concept");
    const [asked] = savesAsked();
    expect(asked?.sources).toEqual(["Audit handbook", "Calder handbook"]);
    expect(asked?.withheld).toEqual([1]);
  });

  it("opens prefilled from the address", async () => {
    const api = aNewConceptApi();
    const address = newConceptAt({
      new: "Cyber Essentials Plus certificate",
      collection: "policies",
      kind: "certification",
      tags: "cyber-essentials",
      subject: A_CONCEPT_IRI,
    });
    await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: "New Concept" });
    expect(titleField().value).toBe("Cyber Essentials Plus certificate");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Kind" }).value).toBe(
      "certification",
    );
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Tags" }).value).toBe(
      "cyber-essentials",
    );
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Collection" }).value).toBe(
      "policies",
    );
    expect(screen.getByRole("textbox", { name: "Body" }).textContent).toContain(
      "Audit Logs Retention",
    );
    expect(warnings().some((warning) => warning.includes("policies"))).toBe(true);
  });

  it("commits a new concept and opens its page", async () => {
    const api = aNewConceptApi();
    api.set(SAVE, committed);
    const address = newConceptAt({
      new: "Cyber Essentials Plus certificate",
      subject: A_CONCEPT_IRI,
    });
    const router = await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: "New Concept" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(save), "the disabled Save gives no reason").toMatch(/\S/);

    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), {
      target: { value: "policies" },
    });
    await waitFor(() => {
      expect(warnings().some((warning) => warning.includes("policies"))).toBe(true);
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Kind" }), {
      target: { value: "Policy" },
    });
    pressed("Save");

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
      kind: "Policy",
      subject: A_CONCEPT_IRI,
    });
    const router = await openAt(address, api);

    await screen.findByRole("heading", { level: 3, name: "New Concept" });
    await waitFor(() => {
      expect(warnings().some((warning) => warning.includes("policies"))).toBe(true);
    });
    const quiet = screen
      .getAllByRole("status")
      .filter((status) => status.textContent.trim() === "");
    pressed("Save");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 3, name: "New Concept" })).toBeNull();
    });
    expect(
      quiet.some((status) => /\S/u.test(status.textContent)),
      "the suggestion notice closed with its form",
    ).toBe(true);
    expect(router.state.location.searchStr).not.toContain("knowledge.new");
  });
});
