import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import {
  A_CONCEPT_IRI,
  A_CONCEPT_PAGE,
  aConceptApi,
  aConceptToEdit,
  asksOf,
  committed,
  PARTS,
  savesAsked,
  suggested,
  unchanged,
  type Standing,
} from "@test/knowledge/concept-editing-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack, settlingAfter, type Api } from "@test/stubbed-api.ts";
import { aRefusalAnswer, GRACE, NORTHERN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

beforeEach(() => {
  sessionStorage.clear();
});

const TO_EDIT = "knowledge.conceptToEdit";

const SAVE = "knowledge.saveConcept";

const editorOpened = async (api: Api) => {
  const router = await openAt(A_CONCEPT_PAGE, api);
  fireEvent.click(await screen.findByRole("button", { name: /^(Edit|Suggest an edit)$/u }));
  await screen.findByRole("heading", { level: 3, name: /^(Edit This Concept|Suggest an Edit)$/u });
  return router;
};

const titleField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Title" });

const retitled = (title: string) => {
  fireEvent.change(titleField(), { target: { value: title } });
};

const pressed = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const buttonFor = async (standing: Standing) => {
  await openAt(A_CONCEPT_PAGE, aConceptApi(standing));
  const button = await screen.findByRole("button", { name: /^(Edit|Suggest an edit)$/u });
  const name = button.textContent;
  cleanup();
  return name;
};

describe("editing a concept on its own page", () => {
  it("draws Edit for a committer and Suggest for others", async () => {
    expect(await buttonFor("commits")).toBe("Edit");
    expect(await buttonFor("suggests")).toBe("Suggest an edit");
  });

  it("reads the concept to edit after the press", async () => {
    const api = aConceptApi("commits");
    await openAt(A_CONCEPT_PAGE, api);
    const button = await screen.findByRole("button", { name: "Edit" });
    expect(screen.queryByText("The editor is still loading.")).toBeNull();
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
    expect(
      await screen.findByText("It is used in 2 places, and each one will show the change."),
    ).toBeDefined();
    expect(savesAsked()).toHaveLength(0);

    pressed("Save");
    expect(await screen.findByText("Saved.")).toBeDefined();
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed"]);
    expect(screen.queryByText(/It is used in/u)).toBeNull();
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

    expect(
      await screen.findByText("It is used in 3 places, and each one will show the change."),
    ).toBeDefined();
    pressed("Save");
    expect(await screen.findByText("Saved.")).toBeDefined();
    expect(savesAsked().map((asked) => asked.reuse)).toEqual(["confirmed", "confirmed"]);
  });

  it("states what a save does before it commits", async () => {
    await editorOpened(aConceptApi("commits"));
    expect(
      screen.getByText("Saving changes this concept for everyone who reads it."),
    ).toBeDefined();
    cleanup();

    await editorOpened(aConceptApi("suggests"));
    expect(
      screen.getByText(
        "Saving sends your edit to the concept's owner. Nothing changes until they decide.",
      ),
    ).toBeDefined();
  });

  it("opens a table body as markdown with the reason", async () => {
    const body = "| Year | Kept |\n| --- | --- |\n| 2026 | Yes |";
    await editorOpened(aConceptApi("commits", { parts: { ...PARTS, body } }));

    expect(
      await screen.findByText(
        "This text uses markdown the visual editor would change, so it opens as markdown.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Markdown" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Visual" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("says Saving before the server answers, then Saved", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, committed);
    const held = heldBack(api, SAVE);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");
    expect(screen.getByText("Saving.").tagName).toBe("OUTPUT");

    await held.asked;
    held.resolve();
    expect(await screen.findByText("Saved.")).toBeDefined();
    expect(screen.queryByRole("heading", { level: 3, name: "Edit This Concept" })).toBeNull();
  });

  it("says nothing changed when the server finds no change", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, unchanged);
    await editorOpened(api);

    pressed("Save");

    expect(await screen.findByText("Nothing changed, so nothing was saved.")).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Edit This Concept" })).toBeDefined();
  });

  it("says the suggestion waits for the owner", async () => {
    const api = aConceptApi("suggests");
    api.set(SAVE, suggested);
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");

    expect(
      await screen.findByText("Your suggestion is waiting for the concept's owner to decide."),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { level: 3, name: "Suggest an Edit" })).toBeNull();
  });

  it("offers a reload when the concept changed after it opened", async () => {
    const api = aConceptApi("commits");
    api.set(SAVE, () => aRefusalAnswer("stale-precondition", "conflict", 409));
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Save");

    expect(await screen.findByText("This concept changed after you opened it.")).toBeDefined();
    api.set(TO_EDIT, () => aConceptToEdit({ base: "second-base" }));
    pressed("Reload the concept");

    await waitFor(() => {
      expect(titleField().value).toBe("Audit Logs Retention");
    });
    expect(asksOf(TO_EDIT)).toHaveLength(2);
    expect(screen.queryByText("This concept changed after you opened it.")).toBeNull();
  });

  it("refuses to save an empty body and sends nothing", async () => {
    const api = aConceptApi("commits", { parts: { ...PARTS, body: "" } });
    api.set(SAVE, committed);
    await editorOpened(api);

    const save = screen.getByRole("button", { name: "Save" });
    const reason = "Add some text to the body before you save. A concept cannot be saved empty.";
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(reason).id).toBe(save.getAttribute("aria-describedby"));

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

    expect(await screen.findByText("Saved.")).toBeDefined();
  });

  it("keeps the draft after Close editor and gives it back", async () => {
    const api = aConceptApi("commits");
    await editorOpened(api);

    retitled("Audit Log Retention");
    pressed("Close editor");
    expect(screen.queryByRole("heading", { level: 3, name: "Edit This Concept" })).toBeNull();

    pressed("Edit");
    await screen.findByRole("heading", { level: 3, name: "Edit This Concept" });
    expect(titleField().value).toBe("Audit Log Retention");
  });

  it("gives a person's draft to no one else", async () => {
    await editorOpened(aConceptApi("commits"));
    retitled("Audit Log Retention");
    pressed("Close editor");
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

  it("asks before leaving with changes that are not saved", async () => {
    const router = await editorOpened(aConceptApi("commits"));

    retitled("Audit Log Retention");
    act(() => {
      void router.navigate({ href: SEARCH_PAGE.path });
    });
    expect(await screen.findByText("You have changes that are not saved.")).toBeDefined();
    expect(router.state.location.pathname).toBe(A_CONCEPT_PAGE);

    pressed("Keep editing");
    await waitFor(() => {
      expect(screen.queryByText("You have changes that are not saved.")).toBeNull();
    });

    act(() => {
      void router.navigate({ href: SEARCH_PAGE.path });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SEARCH_PAGE.path);
    });
  });

  it("sends the edited sources and counts the withheld", async () => {
    const api = aConceptApi("commits", {
      sources: ["Retention policy", "Audit handbook"],
      withheld: [{ at: 1, label: "Restricted board minutes" }],
    });
    api.set(SAVE, committed);
    await editorOpened(api);

    expect(screen.getByText("1 source you cannot open stays as it is")).toBeDefined();
    expect(screen.queryByText(/Restricted board minutes/u)).toBeNull();
    pressed("Remove source 1");
    pressed("Add a source");
    fireEvent.change(screen.getByRole("textbox", { name: "Source 2" }), {
      target: { value: "Calder handbook" },
    });
    pressed("Save");

    await screen.findByText("Saved.");
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
    expect(
      screen.getByText("Saving adds this concept for everyone who can read policies."),
    ).toBeDefined();
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
    expect(screen.getByText("Choose a collection before you save.")).toBeDefined();

    fireEvent.change(screen.getByRole("combobox", { name: "Collection" }), {
      target: { value: "policies" },
    });
    await screen.findByText("Saving adds this concept for everyone who can read policies.");
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
    await screen.findByText("Saving adds this concept for everyone who can read policies.");
    pressed("Save");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 3, name: "New Concept" })).toBeNull();
    });
    expect(
      await screen.findByText("Your suggestion is waiting for the concept's owner to decide."),
    ).toBeDefined();
    expect(router.state.location.searchStr).not.toContain("knowledge.new");
  });
});

const newConceptAt = (fields: Readonly<Record<string, string>>): string => {
  const query = new URLSearchParams(
    Object.entries(fields).map(([name, value]) => [`knowledge.${name}`, value]),
  );
  return `${SEARCH_PAGE.path}?${query.toString()}`;
};

const aNewConceptApi = (): Api => {
  const api = aConceptApi("commits", {
    parts: { ...PARTS, title: "", kind: "", tags: [], body: "" },
    sources: [],
    base: null,
    usedIn: 0,
  });
  api.set("knowledge.tree", () =>
    read({
      collections: [{ collection: "policies", count: 1, kinds: [{ kind: "Policy", count: 1 }] }],
    }),
  );
  return api;
};
