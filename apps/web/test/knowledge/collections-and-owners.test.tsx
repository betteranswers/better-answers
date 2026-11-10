import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { COLLECTIONS_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { RHIAN } from "@test/knowledge/all-knowledge-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server } from "@test/stub-server.ts";
import { ADA, adaAnAdmin, aRefusalAnswer, NORTHERN, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const PAGE = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Collections and Owners").path;

const POLICY = { collection: "policy", owner: null, overrides: 0, concepts: 3, verified: 1 };

const NAMED = collectionNameOf(POLICY.collection);

const region = () => within(screen.getByRole("region", { name: "Collections and Owners" }));

const pickerOf = (owner: string) =>
  screen.findByRole("button", { name: WORDS.ownerOf(NAMED, owner) });

const choosing = async (person: string) => {
  fireEvent.click(await screen.findByRole("option", { name: person }));
};

const cellsOf = (collection: string) => {
  const row = region()
    .getByRole("cell", { name: collectionNameOf(collection) })
    .closest("tr");
  assert(row !== null, `${collection} has no row`);
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
};

const collectionsAsks = (): number =>
  server.asks.filter((ask) => ask.procedure === "knowledge.collections").length;

const namingAsks = () =>
  server.asks.filter((ask) => ask.procedure === "knowledge.nameOwner").map((ask) => ask.input);

const aCollectionsApi = () => {
  const api = adaAnAdmin();
  api.set("members.list", () => read([ADA, RHIAN]));
  api.set("knowledge.collections", () => read({ collections: [POLICY] }));
  api.set("knowledge.nameOwner", () => read({ auditEventId: "01JEVENT", personId: null }));
  return api;
};

const SAFETY = { collection: "safety", owner: null, overrides: 0, concepts: 1, verified: 0 };

const pickerNamed = (collection: string) =>
  screen.findByRole("button", {
    name: WORDS.ownerOf(collectionNameOf(collection), WORDS.noOwner),
  });

const chosenFor = async (collection: string, person: string) => {
  fireEvent.click(await pickerNamed(collection));
  await choosing(person);
};

const alertedIn = (collection: string): boolean => {
  const row = region().getByRole("row", { name: new RegExp(collectionNameOf(collection), "u") });
  return within(row)
    .getAllByRole("alert")
    .some((alert) => /\S/u.test(alert.textContent));
};

const ownedByRhian = () => {
  const api = aCollectionsApi();
  api.set("knowledge.collections", () =>
    read({
      collections: [{ ...POLICY, owner: { id: RHIAN.personId, name: RHIAN.displayName } }],
    }),
  );
  return api;
};

describe("the Collections and Owners page", () => {
  it("shows each collection's display name, concepts and verified share", async () => {
    const api = aCollectionsApi();
    api.set("knowledge.collections", () =>
      read({
        collections: [
          POLICY,
          { collection: "safety-rules", owner: null, overrides: 2, concepts: 1, verified: 1 },
          { collection: "wide", owner: null, overrides: 0, concepts: 200, verified: 199 },
        ],
      }),
    );
    await openAt(PAGE, api);

    await pickerOf(WORDS.noOwner);

    expect(cellsOf("policy")).toEqual([NAMED, WORDS.noOwner, "3", "33%"]);
    expect(cellsOf("safety-rules")).toEqual([
      collectionNameOf("safety-rules"),
      `${WORDS.noOwner}${WORDS.ownOwners(2)}`,
      "1",
      "100%",
    ]);
    expect(cellsOf("wide").at(-1), "a share one short of all showed as complete").toBe("99%");
    expect(region().queryByText(POLICY.collection)).toBeNull();
    expect(region().queryByText("safety-rules")).toBeNull();
  });

  it("saves a chosen owner at once, with Undo", async () => {
    await openAt(PAGE, aCollectionsApi());

    fireEvent.click(await pickerOf(WORDS.noOwner));
    await choosing(RHIAN.displayName);

    const undo = await screen.findByRole("button", { name: WORDS.undo });
    expect(namingAsks()).toEqual([{ collection: POLICY.collection, personId: RHIAN.personId }]);

    fireEvent.click(undo);

    await waitFor(() => {
      expect(namingAsks()).toEqual([
        { collection: POLICY.collection, personId: RHIAN.personId },
        { collection: POLICY.collection, personId: null },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: WORDS.undo })).toBeNull();
    });
  });

  it("clears the owner when No owner is chosen", async () => {
    await openAt(PAGE, ownedByRhian());

    fireEvent.click(await pickerOf(RHIAN.displayName));
    await choosing(WORDS.noOwner);

    await screen.findByRole("button", { name: WORDS.undo });
    expect(namingAsks()).toEqual([{ collection: POLICY.collection, personId: null }]);
  });

  it("asks nothing when the owner already chosen is chosen again", async () => {
    await openAt(PAGE, ownedByRhian());

    fireEvent.click(await pickerOf(RHIAN.displayName));
    await choosing(RHIAN.displayName);

    expect(namingAsks()).toEqual([]);
    expect(screen.queryByRole("button", { name: WORDS.undo })).toBeNull();
  });

  it("filters people by name and resets after a choice", async () => {
    await openAt(PAGE, aCollectionsApi());

    fireEvent.click(await pickerOf(WORDS.noOwner));
    fireEvent.change(await screen.findByPlaceholderText(WORDS.searchPeople), {
      target: { value: "pryce" },
    });
    await waitFor(() => {
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        RHIAN.displayName,
      ]);
    });
    await choosing(RHIAN.displayName);
    fireEvent.click(await pickerOf(WORDS.noOwner));

    const offered = await screen.findAllByRole("option");
    expect(offered.map((option) => option.textContent)).toContain(ADA.displayName);
    expect(screen.getByPlaceholderText(WORDS.searchPeople)).toHaveProperty("value", "");
  });

  it("alerts beside the picker on a refusal", async () => {
    const api = aCollectionsApi();
    api.set("knowledge.nameOwner", () => aRefusalAnswer("no-such-member", "precondition", 412));
    await openAt(PAGE, api);

    await chosenFor(POLICY.collection, RHIAN.displayName);

    await waitFor(() => {
      expect(alertedIn(POLICY.collection), "the refused naming raised no alert in its row").toBe(
        true,
      );
    });
    expect(screen.queryByRole("button", { name: WORDS.undo })).toBeNull();
    expect(await pickerOf(WORDS.noOwner)).toBeDefined();
  });

  it("keeps each collection's refusal beside its own picker", async () => {
    const api = aCollectionsApi();
    api.set("knowledge.collections", () => read({ collections: [POLICY, SAFETY] }));
    api.set("knowledge.nameOwner", () => aRefusalAnswer("no-such-member", "precondition", 412));
    await openAt(PAGE, api);

    await chosenFor(POLICY.collection, RHIAN.displayName);
    await chosenFor(SAFETY.collection, RHIAN.displayName);

    await waitFor(() => {
      expect(alertedIn(POLICY.collection), "the refusal beside the first picker was lost").toBe(
        true,
      );
      expect(alertedIn(SAFETY.collection)).toBe(true);
    });
  });

  it("keeps Undo on the newest change", async () => {
    const api = aCollectionsApi();
    api.set("knowledge.collections", () => read({ collections: [POLICY, SAFETY] }));
    const slowest = Promise.withResolvers<unknown>();
    const saved = read({ auditEventId: "01JEVENT", personId: null });
    const answers: unknown[] = [slowest.promise, saved];
    api.set("knowledge.nameOwner", () => answers.shift());
    await openAt(PAGE, api);

    await chosenFor(POLICY.collection, RHIAN.displayName);
    await chosenFor(SAFETY.collection, RHIAN.displayName);
    await screen.findByRole("button", { name: WORDS.undo });
    const readsBefore = collectionsAsks();
    slowest.resolve(saved);
    await waitFor(() => {
      expect(collectionsAsks()).toBeGreaterThan(readsBefore);
    });
    await act(async () => {
      await new Promise((done) => {
        setTimeout(done);
      });
    });
    fireEvent.keyDown(document.body, { key: "u" });

    await waitFor(() => {
      expect(namingAsks().at(-1)).toEqual({ collection: SAFETY.collection, personId: null });
    });
  });

  it("undoes the last owner change by its keystroke", async () => {
    await openAt(PAGE, aCollectionsApi());
    fireEvent.click(await pickerOf(WORDS.noOwner));
    await choosing(RHIAN.displayName);
    await screen.findByRole("button", { name: WORDS.undo });

    fireEvent.keyDown(document.body, { key: "u" });

    await waitFor(() => {
      expect(namingAsks().at(-1)).toEqual({ collection: POLICY.collection, personId: null });
    });
  });

  it("shows a Viewer who owns a collection no picker", async () => {
    const api = adaAnAdmin();
    api.set("session.member", () =>
      read({
        workspace: NORTHERN,
        person: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
        role: "Viewer",
        owns: { collections: ["policy"], concepts: 0 },
      }),
    );
    api.set("knowledge.collections", () =>
      read({
        collections: [{ ...POLICY, owner: { id: ADA.personId, name: "Rhian Pryce" } }],
      }),
    );
    await openAt(PAGE, api);

    expect(await region().findByRole("cell", { name: NAMED })).toBeDefined();
    expect(region().getByRole("cell", { name: "Rhian Pryce" })).toBeDefined();
    expect(region().queryAllByRole("button")).toHaveLength(0);
  });
});
