import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { WAITING_KEYSTROKES as KEY, WAITING_ON_YOU } from "@/features/inbox/inbox-state.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  clockTheNextKey,
  nameOwners,
  person,
  provision,
  seedEditSuggestion,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  theActionsLandedWithinTheirBudget,
} from "../harness.ts";
import { conceptsSeeded, listsItsKeystrokes, scrolledSideways } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const LIST_SAMPLES = 3;

const NARROW = { width: 320, height: 720 };

const PROPOSER = "Ifan Morgan";

const VIEWER = "Rhian Pryce";

const EDITOR = "Cerys Lloyd";

const LEAVE = "Annual leave";

const CLAIMS = "Expense claims";

const DRILLS = "Fire drills";

type Member = { readonly id: string; readonly email: string };

type Seeded = Awaited<ReturnType<typeof conceptsSeeded>>;

type Owned = Parameters<typeof nameOwners>[1]["owners"][number];

type SeedConcept = Parameters<typeof conceptsSeeded>[1]["concepts"][number];

type Deciding = {
  readonly workspaceId: string;
  readonly admin: Member;
  readonly proposer: Member;
  readonly viewer: Member;
  readonly editor: Member;
  readonly concepts: Seeded;
  readonly iriOf: (title: string) => string;
};

const aDecidingWorkspace = async (
  api: APIRequestContext,
  name: string,
  further: readonly SeedConcept[] = [],
): Promise<Deciding> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const joined = async (role: "Editor" | "Viewer", displayName: string): Promise<Member> => {
    const made = await person(api, anAddress(role.toLowerCase()), { displayName });
    await addMember(api, { workspaceId, role, userId: made.id });
    return made;
  };
  const proposer = await joined("Editor", PROPOSER);
  const viewer = await joined("Viewer", VIEWER);
  const editor = await joined("Editor", EDITOR);
  const concepts = await conceptsSeeded(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      { title: LEAVE, collection: "policies", body: "Everyone takes 25 days of leave." },
      { title: CLAIMS, collection: "policies", body: "Claims go in within 30 days." },
      { title: DRILLS, collection: "safety", body: "A fire drill runs each quarter." },
      ...further,
    ],
  });
  const iriOf = (title: string): string => {
    const iri = concepts.get(title)?.iri;
    if (iri === undefined) throw new Error(`${title} was not seeded`);
    return iri;
  };
  return {
    workspaceId,
    admin: { id: workspace.admin.id, email: adminEmail },
    proposer,
    viewer,
    editor,
    concepts,
    iriOf,
  };
};

const ownersNamed = (api: APIRequestContext, at: Deciding, owners: readonly Owned[]) =>
  nameOwners(api, { workspaceId: at.workspaceId, userId: at.admin.id, owners });

const suggested = (api: APIRequestContext, at: Deciding, title: string, body: string) =>
  seedEditSuggestion(api, {
    workspaceId: at.workspaceId,
    userId: at.proposer.id,
    iri: at.iriOf(title),
    body,
  });

const signedIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const waiting = (page: Page): Locator => page.getByRole("region", { name: "Waiting on You" });

const rowTitles = (page: Page): Locator => waiting(page).getByRole("heading", { level: 3 });

const rowLink = (page: Page, title: string): Locator =>
  waiting(page).getByRole("link", { name: title, exact: true });

const tickOf = (page: Page, title: string): Locator =>
  waiting(page).getByRole("checkbox", { name: `Select ${title}` });

const said = (page: Page): Locator => waiting(page).getByRole("status").nth(1);

const SAID_AT = "(//section[.//h2[.='Waiting on You']]//output)[2]";

const answered = async (page: Page, procedure: "accept" | "decline", act: () => Promise<void>) => {
  const answer = page.waitForResponse((each) => each.url().includes(`inbox.${procedure}`));
  await act();
  expect((await answer).ok(), `the ${procedure} was refused`).toBe(true);
};

const signedInAtTheList = async (page: Page, api: APIRequestContext, email: string) => {
  await signedIn(page, api, email);
  await page.goto(WAITING_ON_YOU.path);
  await expect(waiting(page).getByRole("heading", { level: 2 })).toBeVisible();
};

test.describe("Waiting on You", () => {
  test("an Editor owner bulk-accepts by keyboard alone at 320px", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Corve Dale Cider");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.editor.id }]);
    await suggested(request, at, LEAVE, "Leave is 30 days.");
    await suggested(request, at, CLAIMS, "Claims go in within a week.");
    await page.setViewportSize(NARROW);
    await signedInAtTheList(page, request, at.editor.email);

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Waiting on You", KEY, [
      "Select or Clear the Suggestion in Focus",
      "Accept the Selected Suggestions",
    ]);
    await tabUntilFocused(page, rowLink(page, LEAVE));
    await page.keyboard.press(KEY.tick.key);
    await expect(tickOf(page, LEAVE)).toBeChecked();
    await tabUntilFocused(page, rowLink(page, CLAIMS));
    await page.keyboard.press(KEY.tick.key);
    await expect(tickOf(page, CLAIMS)).toBeChecked();
    await answered(page, "accept", () => page.keyboard.press(`Shift+${KEY.acceptSelected.key}`));

    await expect(said(page)).toContainText(LEAVE);
    await expect(said(page)).toContainText(CLAIMS);
    await expect(rowTitles(page)).toHaveCount(0);
    expect(await scrolledSideways(page), "the list scrolls sideways at 320px").toBe(0);
  });

  test("renders within its budget", async ({ page, request }) => {
    test.slow();
    const collections = ["policies", "safety", "finance", "people", "estates"];
    const adminEmail = anAddress("admin");
    const workspace = await provision(request, { name: "Rhondda Valley Logistics", adminEmail });
    const { workspaceId } = workspace;
    const proposer = await person(request, anAddress("editor"), { displayName: PROPOSER });
    await addMember(request, { workspaceId, userId: proposer.id, role: "Editor" });
    const concepts = await conceptsSeeded(request, {
      workspaceId,
      userId: workspace.admin.id,
      concepts: collections.flatMap((collection) =>
        [1, 2].map((at) => ({
          title: `${collection} rule ${String(at)}`,
          collection,
          body: `The ${collection} rule ${String(at)} holds.`,
        })),
      ),
    });
    const titles = [...concepts.keys()];
    for (const [title, { iri }] of concepts) {
      for (const draft of [1, 2, 3, 4, 5]) {
        await seedEditSuggestion(request, {
          workspaceId,
          userId: proposer.id,
          iri,
          body: `Draft ${String(draft)} of ${title}.`,
        });
      }
    }
    await signedIn(page, request, adminEmail);

    const rendered: number[] = [];
    for (let sample = 0; sample < LIST_SAMPLES; sample += 1) {
      const started = Date.now();
      await page.goto(WAITING_ON_YOU.path);
      await expect(rowTitles(page)).toHaveCount(50);
      rendered.push(Date.now() - started);
    }
    const [, median] = rendered.toSorted((one, other) => one - other);
    assert.ok(median !== undefined, "the list was drawn fewer than twice");
    test.info().annotations.push({
      type: "waiting on you",
      description: `${rendered.map((elapsed) => `${String(elapsed)} ms`).join(", ")}; median ${String(median)} ms`,
    });
    expect(median, "the list rendered past its budget").toBeLessThan(LIST_BUDGET_MS);

    const clocked: number[] = [];
    for (const title of titles.slice(0, ACTION_SAMPLES)) {
      await tickOf(page, title).first().check();
      await clockTheNextKey(page, { at: SAID_AT, reads: title });
      await answered(page, "accept", async () => {
        await page.keyboard.press(`Shift+${KEY.acceptSelected.key}`);
        clocked.push(await actionClocked(page));
      });
      await expect(said(page)).toContainText(PROPOSER);
    }
    theActionsLandedWithinTheirBudget("accepting a suggestion", clocked);
  });
});
