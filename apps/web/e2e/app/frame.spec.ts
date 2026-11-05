import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";
import { z } from "zod";

import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  actionClocked,
  addMember,
  anAddress,
  avatarOf,
  clockTheNextDraw,
  contrastBetween,
  crumbOf,
  keystrokesButton,
  landedAtHome,
  navOf,
  notFoundOfferingHome,
  person,
  provision,
  railOf,
  signIn,
  signInHeading,
  signInSaysWhy,
  signOutFromTheShell,
  signedInAtHome,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  tokenPainted,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and Spend");

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const PAGE_NAMES = [
  "Connected Sources",
  "Models and Spend",
  "Questions Asked",
  "Answer Tests",
  "Members",
  "Groups",
  "Audit Log",
];

const AREA_NAMES = ["Ask", "Knowledge", "Inbox", "Control Centre"];

const ITS_HEADING = "Models";

const NARROW = { width: 320, height: 720 };

const NOWHERE = "/nothing-here";

const FAILED_HEADING = "This Page Didn’t Load";

const NOT_A_LIST = { why: "the api answered a shape the model choices card cannot render" };

const MODEL_CHOICES_LIST = "modelChoices.list";

const INVITE_A_PERSON = "Invite a Person";

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const NON_TEXT_CONTRAST = 3;

const STOPS = 60;

const bandOf = (page: Page) => page.getByRole("banner");

const logoOf = (page: Page) => bandOf(page).getByRole("link", { name: "better-answers" });

const closerOf = (page: Page) => page.getByRole("button", { name: "Hide Menu" });

const sheetButtonOf = (page: Page) => page.getByRole("button", { name: "Menu", exact: true });

const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Menu", exact: true });

const jumpToOf = (page: Page) => bandOf(page).getByRole("button", { name: "Jump To" });

const tabsOf = (page: Page) => page.getByRole("tablist", { name: "Models and Spend" });

const modelChoicesCardOf = (page: Page) => page.getByRole("region", { name: "Model Choices" });

const theModelChoicesHaveLanded = (page: Page) =>
  expect(modelChoicesCardOf(page).getByRole("paragraph")).toHaveCount(3);

const unknownPage = (page: Page) => page.getByRole("heading", { level: 1, name: "Page Not Found" });

const jumpToDialogOf = (page: Page) => page.getByRole("dialog", { name: "Jump To" });

const jumpToOptionOf = (page: Page, name: string | RegExp) =>
  jumpToDialogOf(page).getByRole("option", { name });

const boxOf = async (region: Locator) => {
  const box = await region.boundingBox();
  if (box === null) throw new Error("the region is not drawn");
  return box;
};

const topOf = async (region: Locator): Promise<number> => (await boxOf(region)).y;

const sidewaysRoom = (page: Page) =>
  page.evaluate(() => ({
    scrolls: document.documentElement.scrollWidth,
    holds: document.documentElement.clientWidth,
  }));

const scrollsNothingSideways = async (page: Page, when: string) => {
  const room = await sidewaysRoom(page);
  expect(room.scrolls, `the page scrolls sideways ${when}`).toBeLessThanOrEqual(room.holds);
};

const contentIsLastWithNoJumps = () => {
  const bar = document.querySelector("header");
  const content = document.querySelector("main");
  if (bar === null || content === null) return false;
  const following = bar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
  const jumped = [...document.querySelectorAll("[tabindex]")].some(
    (element) => Number(element.getAttribute("tabindex")) > 0,
  );
  return following !== 0 && !jumped;
};

const inDocumentOrder = async (page: Page, regions: readonly Locator[]): Promise<boolean> => {
  const nodes = await Promise.all(regions.map((region) => region.elementHandle()));
  return page.evaluate(
    (drawn) =>
      drawn.every(
        (node, at) =>
          at === 0 ||
          ((drawn[at - 1]?.compareDocumentPosition(node) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    nodes,
  );
};

const signedIn = async (page: Page, api: Parameters<typeof provision>[0], name: string) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

const narrowAtModelsAndSpend = async (
  page: Page,
  api: Parameters<typeof provision>[0],
  name: string,
) => {
  await signedIn(page, api, name);
  await page.setViewportSize(NARROW);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();
};

const provisionedWithATeam = async (api: APIRequestContext, name: string, adminEmail: string) => {
  const workspace = await provision(api, { name, adminEmail });
  for (const [address, displayName, role] of [
    [anAddress("priya"), PRIYA, "Editor"],
    [anAddress("tom"), TOM, "Viewer"],
  ] as const) {
    const member = await person(api, address, { displayName });
    await addMember(api, { workspaceId: workspace.workspaceId, userId: member.id, role });
  }
  return workspace;
};

const modelChoicesBroken = async (route: Route) => {
  const answered = await route.fetch();
  const procedures = decodeURIComponent(new URL(route.request().url()).pathname)
    .replace("/trpc/", "")
    .split(",");
  if (!procedures.includes(MODEL_CHOICES_LIST)) {
    await route.fulfill({ response: answered });
    return;
  }
  const answers: unknown = await answered.json();

  const batch = z.array(z.unknown()).safeParse(answers);
  const broken = batch.success
    ? batch.data.map((answer, index) =>
        procedures[index] === MODEL_CHOICES_LIST ? { result: { data: NOT_A_LIST } } : answer,
      )
    : { result: { data: NOT_A_LIST } };
  await route.fulfill({ json: broken });
};

test("the shell's header, rail, and menu work by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("shell");
  const workspace = await provisionedWithATeam(request, "Wharfedale Castings", email);

  await test.step("shows a signed-out visitor the logo and Sign In on an unknown page", async () => {
    await page.goto(NOWHERE);

    await expect(unknownPage(page)).toBeVisible();
    await expect(bandOf(page)).toHaveText("better-answers", { useInnerText: true });
    await expect(page.getByRole("main").getByRole("link")).toHaveText(["Sign In"]);
    await expect(page).toHaveURL(NOWHERE);
    await passesTheAccessibilityGate();

    await page.getByRole("link", { name: "Sign In" }).click();
    await expect(signInHeading(page)).toBeVisible();
  });

  await page.goto(MODELS_AND_SPEND.path);
  await signIn(page, request, email);
  await expect(page).toHaveURL(new RegExp(`${MODELS_AND_SPEND.path}$`));

  await test.step("Tab visits the skip link, header, rail, menu, tabs, and panel in order", async () => {
    const rail = railOf(page);
    await expect(rail.getByRole("link", { name: "Control Centre" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await theModelChoicesHaveLanded(page);

    const band = [
      logoOf(page),
      switcherOf(page, workspace.name),
      closerOf(page),
      crumbOf(page, "Control Centre"),
      crumbOf(page, "Models"),
      crumbOf(page, "Models and Spend"),
      jumpToOf(page),
      avatarOf(page, workspace.admin.name),
    ];
    expect(
      await inDocumentOrder(page, band),
      "the header's controls are out of document order",
    ).toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the Page" })).toBeFocused();

    for (const stop of band) {
      await page.keyboard.press("Tab");
      await expect(stop).toBeFocused();
    }

    for (const name of AREA_NAMES) {
      await page.keyboard.press("Tab");
      await expect(rail.getByRole("link", { name })).toBeFocused();
    }

    await page.keyboard.press("Tab");
    await expect(keystrokesButton(rail)).toBeFocused();

    for (const name of PAGE_NAMES) {
      await page.keyboard.press("Tab");
      await expect(navOf(page, "Control Centre").getByRole("link", { name })).toBeFocused();
    }

    const offer = page.getByRole("region", { name: "Passkeys" });
    await page.keyboard.press("Tab");
    await expect(offer.getByRole("link", { name: "Add a Passkey" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(offer.getByRole("button", { name: "Dismiss Passkey Offer" })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(tabsOf(page).getByRole("tab", { name: "Model Choices" })).toBeFocused();

    const panel = page.getByRole("tabpanel");
    await page.keyboard.press("Tab");
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("region", { name: "Model Choices" })).toBeVisible();

    const contentIsLast = await page.evaluate(contentIsLastWithNoJumps);
    expect(contentIsLast).toBe(true);
  });

  await test.step("passes the accessibility gate with the workspace switcher menu open", async () => {
    await switcherOf(page, workspace.name).click();
    await expect(switcherMenuOf(page, workspace.name)).toBeVisible();
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(switcherMenuOf(page, workspace.name)).toHaveCount(0);
  });

  await test.step("opens the Jump To list within one second, timed in the browser", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: ITS_HEADING })).toBeVisible();

    await clockTheNextDraw(page, { at: "//*[@role='dialog']", reads: TOM });
    await page.keyboard.press("Meta+k");
    const elapsed = await actionClocked(page);
    test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
    expect(elapsed, "the Jump To list took longer than one second to draw").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(jumpToDialogOf(page).getByRole("group", { name: "Pages" })).toBeVisible();
    await expect(jumpToOptionOf(page, new RegExp(PRIYA))).toBeVisible();
    await expect(jumpToOptionOf(page, INVITE_A_PERSON)).toBeVisible();
  });

  await page.route("**/trpc/**", modelChoicesBroken);
  await page.goto(MODELS_AND_SPEND.path);
  const failed = page.getByRole("heading", { level: 1, name: FAILED_HEADING });
  const navigation = page.getByRole("navigation", { name: "Control Centre" });

  await test.step("shows an error with a way out, and the shell still works by keyboard", async () => {
    await expect(page.getByRole("alert").filter({ has: failed })).toBeVisible();
    await expect(page.getByRole("alert").getByRole("paragraph")).toHaveText(/\S/);
    await expect(page.getByRole("link", { name: "Go to Members" })).toHaveAttribute(
      "href",
      HOMES.Admin.path,
    );
    const everything = page.locator("body");
    await expect(everything).not.toContainText("TypeError");
    await expect(everything).not.toContainText("is not a function");

    await expect(bandOf(page).getByText(workspace.name)).toBeVisible();
    await expect(railOf(page).getByRole("link")).toHaveText(AREA_NAMES);
    await expect(navigation.getByRole("link", { name: "Audit Log" })).toBeVisible();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tab", { name: "Model Choices" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Try Again" })).toBeFocused();

    await passesTheAccessibilityGate();
  });

  await test.step("opens another tab and another page after the failure", async () => {
    await expect(page.getByRole("tab", { name: "Model Choices" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Spend" }).click();
    await expect(page.getByRole("tab", { name: "Spend" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveText(/\S/);
    await expect(failed).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await navigation.getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test("never scrolls sideways at 320 px, menu open or closed", async ({ page, request }) => {
  await narrowAtModelsAndSpend(page, request, "Acme Joinery");

  await scrollsNothingSideways(page, "with the sheet closed");

  const bar = await topOf(bandOf(page));
  const content = await topOf(page.getByRole("main"));
  expect(bar).toBeLessThan(content);

  await sheetButtonOf(page).click();
  await expect(sheetOf(page)).toBeVisible();

  await scrollsNothingSideways(page, "with the sheet open");
});

test("sends an Admin from an unknown page to their home", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("admin");
  const admin = await person(request, email, { displayName: "An Admin" });
  const workspace = await provision(request, { name: "A workspace for an Admin" });
  await addMember(request, {
    role: "Admin",
    userId: admin.id,
    workspaceId: workspace.workspaceId,
  });

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await page.goto("/not-a-page");

  await notFoundOfferingHome(page, "Admin");
  await expect(railOf(page)).toBeVisible();
  await passesTheAccessibilityGate();
  await skipLinkReachesThePage(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Go to Members" })).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
});

type Drawn = {
  readonly again: boolean;
  readonly rings: number;
  readonly name: string;
  readonly shadow: string;
  readonly ring: string;
  readonly edge: string;
  readonly fill: string;
  readonly behind: string;
};

const focusSettled = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const running = document.activeElement?.getAnimations({ subtree: true }) ?? [];
    await Promise.all(
      running
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

const drawnFocus = (page: Page, edge: string): Promise<Drawn | undefined> =>
  page.evaluate((inked) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return undefined;
    // A browser reports an opaque colour as `rgb()`, and anything see-through as `rgba()`.
    const opaque = (colour: string) => !colour.startsWith("rgba");
    const surfaceBehind = (element: HTMLElement) => {
      let parent = element.parentElement;
      while (parent !== null && !opaque(getComputedStyle(parent).backgroundColor)) {
        parent = parent.parentElement;
      }
      return parent === null ? "rgb(255, 255, 255)" : getComputedStyle(parent).backgroundColor;
    };
    // The ring is the element whose box-shadow contains the focus colour. Utility classes add
    // transparent shadow layers, which the filter below drops.
    const ringed = [focused, ...focused.querySelectorAll<HTMLElement>("*")].filter((element) =>
      getComputedStyle(element).boxShadow.includes(inked),
    );
    const drawing = ringed[0] ?? focused;
    const shadow = getComputedStyle(drawing)
      .boxShadow.split(/,(?![^(]*\))\s*/)
      .filter((layer) => !layer.startsWith("rgba(0, 0, 0, 0)"))
      .join(", ");
    const layers = (painted: string) => {
      const colours = painted.match(/rgba?\([^)]+\)/g) ?? [];
      return { ring: colours[0] ?? "", edge: colours.at(-1) ?? "" };
    };
    const behind = surfaceBehind(drawing);
    const own = getComputedStyle(drawing).backgroundColor;
    const fill = [own, behind].find(opaque);
    const again = focused.dataset["focusWalked"] === "";
    focused.dataset["focusWalked"] = "";
    const label = focused.getAttribute("aria-label") ?? focused.textContent;
    return {
      again,
      rings: ringed.length,
      name: `${focused.tagName.toLowerCase()} "${label.trim().slice(0, 40)}"`,
      shadow,
      ...layers(shadow),
      fill: fill ?? behind,
      behind,
    };
  }, edge);

const inkOf = async (page: Page): Promise<string> =>
  (await tokenPainted(page, "--focus-ring", "box-shadow")).match(/rgba?\([^)]+\)/g)?.at(-1) ?? "";

const walked = async (page: Page): Promise<readonly Drawn[]> => {
  const edge = await inkOf(page);
  const seen: Drawn[] = [];
  for (let stop = 0; stop < STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    await focusSettled(page);
    const drawn = await drawnFocus(page, edge);
    if (drawn?.again === true) return seen;
    if (drawn !== undefined) seen.push(drawn);
  }
  throw new Error(
    `focus never came back round in ${String(STOPS)} stops, so the controls past them were never measured`,
  );
};

const holdsTheRing = async (page: Page, stops: readonly Drawn[]): Promise<void> => {
  const token = await tokenPainted(page, "--focus-ring", "box-shadow");
  expect(stops.length, "Tab reached fewer than three controls").toBeGreaterThan(2);
  for (const stop of stops) {
    expect(stop.rings, `${stop.name} draws ${String(stop.rings)} focus rings, not one`).toBe(1);
    expect(
      stop.shadow,
      `${stop.name} draws its focus ring in a colour other than --focus-ring`,
    ).toBe(token);
    const edge = contrastBetween(stop.edge, stop.behind);
    test
      .info()
      .annotations.push({ type: "focus edge", description: `${stop.name}: ${edge.toFixed(2)}:1` });
    expect(
      edge,
      `${stop.name}'s focus ring has less than 3:1 contrast against ${stop.behind}`,
    ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
  }
};

test("draws the standard focus ring on every Members page control", async ({ page, request }) => {
  const email = anAddress("focus");
  await provision(request, { name: "Calder Joinery", adminEmail: email });
  await signedInAtHome(page, request, email);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await skipLinkReachesThePage(page);

  await holdsTheRing(page, await walked(page));
});

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  const workspace = await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await signOutFromTheShell(page, workspace.admin.name);

  const signedOut = await signInSaysWhy(page);

  await page.goto("/people");
  await expect(signInHeading(page)).toBeVisible();
  await expect(
    page.getByRole("status"),
    "the sign-in page does not say the person signed out",
  ).toHaveText(signedOut);
});
