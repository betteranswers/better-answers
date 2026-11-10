import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import { COLLECTIONS_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";
import { KNOWLEDGE, menuGroupIn, pageById } from "@/shared/navigation.ts";
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

const PAGE = pageById(menuGroupIn(KNOWLEDGE, "curation"), "collections-and-owners").path;

const POLICY = { collection: "policy", owner: null, overrides: 0, concepts: 3, verified: 1 };

const NAMED = collectionNameOf(POLICY.collection);

const region = () =>
  within(
    screen.getByRole("region", {
      name: pageById(menuGroupIn(KNOWLEDGE, "curation"), "collections-and-owners").name,
    }),
  );

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

const afterATick = () =>
  act(async () => {
    await new Promise((done) => {
      setTimeout(done);
    });
  });

const collectionsAsks = (): number =>
  server.asks.filter((ask) => ask.procedure === "knowledge.collections").length;

const namingAsks = () =>
  server.asks.filter((ask) => ask.procedure === "knowledge.nameOwner").map((ask) => ask.input);

const undoneByKey = async (collection: string) => {
  fireEvent.keyDown(document.body, { key: "u" });
  await waitFor(() => {
    expect(namingAsks().at(-1)).toEqual({ collection, personId: null });
  });
};

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
    name: WORDS.ownerOf(collectionNameOf(collection), EMPTY_WORDS.owner),
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

const SAVED = read({ auditEventId: "01JEVENT", personId: null });

const REFUSED = aRefusalAnswer("no-such-member", "precondition", 412);

const HEARD = z.object({ collection: z.string(), personId: z.string().nullable() });

const peopleByIds = new Map([RHIAN, ADA].map((member) => [member.personId, member]));

const aLedger = () => {
  const api = aCollectionsApi();
  const owners = new Map<string, { id: string; name: string }>();
  const answers: Promise<unknown>[] = [];
  let rereading: Promise<unknown> = Promise.resolve();
  let asked = (): void => undefined;
  api.set("knowledge.collections", async () => {
    asked();
    await rereading;
    return read({
      collections: [POLICY, SAFETY].map((each) => ({
        ...each,
        owner: owners.get(each.collection) ?? null,
      })),
    });
  });
  api.set("knowledge.nameOwner", async () => {
    const heard = HEARD.parse(namingAsks().at(-1));
    const answer = await answers.shift();
    const person = peopleByIds.get(heard.personId ?? "");
    if (answer === SAVED) {
      if (person === undefined) owners.delete(heard.collection);
      else owners.set(heard.collection, { id: person.personId, name: person.displayName });
    }
    return answer;
  });
  return {
    api,
    answer: (...next: Promise<unknown>[]) => answers.push(...next),
    holdReads: () => {
      const held = Promise.withResolvers<void>();
      const reached = Promise.withResolvers<void>();
      rereading = held.promise;
      asked = reached.resolve;
      return { release: held.resolve, reached: reached.promise };
    },
  };
};

const openedWithASlowFirstChange = async () => {
  const ledger = aLedger();
  const slow = Promise.withResolvers<unknown>();
  ledger.answer(slow.promise, Promise.resolve(SAVED));
  await openAt(PAGE, ledger.api);
  return slow;
};

const ownerShownFor = (collection: string, owner: string) =>
  screen.findByRole("button", { name: WORDS.ownerOf(collectionNameOf(collection), owner) });

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

    await pickerOf(EMPTY_WORDS.owner);

    expect(cellsOf("policy")).toEqual([NAMED, EMPTY_WORDS.owner, "3", "33%"]);
    expect(cellsOf("safety-rules")).toEqual([
      collectionNameOf("safety-rules"),
      `${EMPTY_WORDS.owner}${WORDS.ownOwners(2)}`,
      "1",
      "100%",
    ]);
    expect(cellsOf("wide").at(-1), "a share one short of all showed as complete").toBe("99%");
    expect(region().queryByText(POLICY.collection)).toBeNull();
    expect(region().queryByText("safety-rules")).toBeNull();
  });

  it("shows 1% for one verified concept in 101", async () => {
    const api = aCollectionsApi();
    api.set("knowledge.collections", () =>
      read({
        collections: [
          { collection: "tiny", owner: null, overrides: 0, concepts: 101, verified: 1 },
          { collection: "bare", owner: null, overrides: 0, concepts: 101, verified: 0 },
        ],
      }),
    );
    await openAt(PAGE, api);

    await pickerNamed("tiny");

    expect(cellsOf("tiny").at(-1), "one verified concept in 101 showed as nothing verified").toBe(
      "1%",
    );
    expect(cellsOf("bare").at(-1)).toBe("0%");
  });

  it("names the owner search and the people list", async () => {
    await openAt(PAGE, aCollectionsApi());

    fireEvent.click(await pickerOf(EMPTY_WORDS.owner));

    expect(await screen.findByRole("combobox", { name: WORDS.searchPeople })).toBeDefined();
    expect(screen.getByRole("listbox", { name: WORDS.people })).toBeDefined();
  });

  it("saves a chosen owner at once, with Undo", async () => {
    await openAt(PAGE, aCollectionsApi());

    fireEvent.click(await pickerOf(EMPTY_WORDS.owner));
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
    await choosing(EMPTY_WORDS.owner);

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

    fireEvent.click(await pickerOf(EMPTY_WORDS.owner));
    fireEvent.change(await screen.findByPlaceholderText(WORDS.searchPeople), {
      target: { value: "pryce" },
    });
    await waitFor(() => {
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        RHIAN.displayName,
      ]);
    });
    await choosing(RHIAN.displayName);
    await screen.findByRole("button", { name: WORDS.undo });
    fireEvent.click(await pickerOf(EMPTY_WORDS.owner));

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
    expect(await pickerOf(EMPTY_WORDS.owner)).toBeDefined();
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
    await afterATick();

    await undoneByKey(SAFETY.collection);
  });

  it("holds a collection's picker until its change settles", async () => {
    const slow = await openedWithASlowFirstChange();

    await chosenFor(POLICY.collection, RHIAN.displayName);
    const held = await ownerShownFor(POLICY.collection, RHIAN.displayName);
    fireEvent.click(held);

    expect(held.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => {
      expect(namingAsks()).toEqual([{ collection: POLICY.collection, personId: RHIAN.personId }]);
    });

    slow.resolve(SAVED);
    await screen.findByRole("button", { name: WORDS.undo });

    const settled = await ownerShownFor(POLICY.collection, RHIAN.displayName);
    expect(settled.getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByText(WORDS.named(RHIAN.displayName, NAMED))).toBeDefined();
    fireEvent.click(settled);
    await choosing(ADA.displayName);
    await screen.findByText(WORDS.named(ADA.displayName, NAMED));
    expect(namingAsks()).toEqual([
      { collection: POLICY.collection, personId: RHIAN.personId },
      { collection: POLICY.collection, personId: ADA.personId },
    ]);
  });

  it("ignores Undo while a later change to the collection saves", async () => {
    const ledger = aLedger();
    const slow = Promise.withResolvers<unknown>();
    ledger.answer(Promise.resolve(SAVED), slow.promise);
    await openAt(PAGE, ledger.api);
    await chosenFor(POLICY.collection, RHIAN.displayName);
    await screen.findByRole("button", { name: WORDS.undo });

    fireEvent.click(await pickerOf(RHIAN.displayName));
    await choosing(ADA.displayName);
    await waitFor(() => {
      expect(namingAsks()).toHaveLength(2);
    });
    fireEvent.keyDown(document.body, { key: "u" });
    fireEvent.click(screen.getByRole("button", { name: WORDS.undo }));
    slow.resolve(SAVED);
    await screen.findByText(WORDS.named(ADA.displayName, NAMED));
    fireEvent.keyDown(document.body, { key: "u" });

    await waitFor(() => {
      expect(namingAsks()).toHaveLength(3);
    });
    await afterATick();
    expect(namingAsks()).toEqual([
      { collection: POLICY.collection, personId: RHIAN.personId },
      { collection: POLICY.collection, personId: ADA.personId },
      { collection: POLICY.collection, personId: RHIAN.personId },
    ]);
  });

  it("keeps a pending change's owner while another collection's change settles", async () => {
    const slow = await openedWithASlowFirstChange();

    await chosenFor(POLICY.collection, RHIAN.displayName);
    await chosenFor(SAFETY.collection, ADA.displayName);
    await screen.findByText(WORDS.named(ADA.displayName, collectionNameOf(SAFETY.collection)));

    expect(
      await ownerShownFor(POLICY.collection, RHIAN.displayName),
      "the pending change's owner was replaced by a read that does not hold it yet",
    ).toBeDefined();
    slow.resolve(SAVED);
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", {
            name: WORDS.ownerOf(collectionNameOf(POLICY.collection), RHIAN.displayName),
          })
          .getAttribute("aria-disabled"),
      ).toBeNull();
    });
  });

  it("keeps a newer save when another collection's change fails", async () => {
    const ledger = aLedger();
    const late = Promise.withResolvers<unknown>();
    ledger.answer(late.promise, Promise.resolve(SAVED));
    await openAt(PAGE, ledger.api);
    const safety = collectionNameOf(SAFETY.collection);

    await chosenFor(POLICY.collection, RHIAN.displayName);
    await chosenFor(SAFETY.collection, ADA.displayName);
    await screen.findByText(WORDS.named(ADA.displayName, safety));
    const rereading = ledger.holdReads();
    late.resolve(REFUSED);
    await rereading.reached;

    await ownerShownFor(POLICY.collection, EMPTY_WORDS.owner);
    expect(
      await ownerShownFor(SAFETY.collection, ADA.displayName),
      "the late failure took the newer save's owner back",
    ).toBeDefined();
    rereading.release();

    await waitFor(() => {
      expect(alertedIn(POLICY.collection), "the refused change raised no alert in its row").toBe(
        true,
      );
    });
    expect(alertedIn(SAFETY.collection), "the refusal was raised in the newer save's row").toBe(
      false,
    );
    expect(screen.getByText(WORDS.named(ADA.displayName, safety))).toBeDefined();
    await undoneByKey(SAFETY.collection);
  });

  it("clears a refusal when the change is made again", async () => {
    const ledger = aLedger();
    ledger.answer(Promise.resolve(REFUSED), Promise.resolve(SAVED));
    await openAt(PAGE, ledger.api);

    await chosenFor(POLICY.collection, RHIAN.displayName);
    await waitFor(() => {
      expect(alertedIn(POLICY.collection)).toBe(true);
    });
    await chosenFor(POLICY.collection, RHIAN.displayName);

    await screen.findByText(WORDS.named(RHIAN.displayName, NAMED));
    expect(alertedIn(POLICY.collection), "the earlier refusal outlived a saved change").toBe(false);
  });

  it("undoes the last owner change by its keystroke", async () => {
    await openAt(PAGE, aCollectionsApi());
    fireEvent.click(await pickerOf(EMPTY_WORDS.owner));
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
