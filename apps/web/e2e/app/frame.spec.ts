import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";
import { z } from "zod";

import { FAILED_PAGE, JUMP_TO, SKIP_TO_MAIN, TOGGLE, UNKNOWN_PAGE } from "@/app/words.ts";
import { PASSKEY_WORDS } from "@/features/auth/account-words.ts";
import { SETUP_WORDS } from "@/features/auth/second-factor/second-factor-words.ts";
import {
  CONTROL_CENTRE,
  HOMES,
  INVITE_A_PERSON,
  menuGroupIn,
  pageById,
} from "@/shared/navigation.ts";

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
  signInStatusText,
  signOutFromTheShell,
  signedInAtHome,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  tokenPainted,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageById(MODELS, "models-and-spend");

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageById(PEOPLE, "members");

const PAGE_NAMES = [
  pageById(menuGroupIn(CONTROL_CENTRE, "sources"), "connected-sources").name,
  pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name,
  pageById(menuGroupIn(CONTROL_CENTRE, "questions"), "questions-asked").name,
  pageById(menuGroupIn(CONTROL_CENTRE, "questions"), "answer-tests").name,
  "Members",
  "Groups",
  pageById(menuGroupIn(CONTROL_CENTRE, "system"), "audit-log").name,
];

const AREA_NAMES = ["Ask", "Knowledge", "Inbox", "Control Centre"];

const MODELS_HEADING = pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name;

const NARROW = { width: 320, height: 720 };

const UNKNOWN_PATH = "/nothing-here";

const FAILED_HEADING = FAILED_PAGE.heading;

const MALFORMED_LIST = { why: "a response the Model Choices card cannot render" };

const MODEL_CHOICES_LIST = "modelChoices.list";

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const NON_TEXT_CONTRAST = 3;

const STOPS = 60;

const headerOf = (page: Page) => page.getByRole("banner");

const logoOf = (page: Page) => headerOf(page).getByRole("link", { name: "better-answers" });

const hideMenuButton = (page: Page) => page.getByRole("button", { name: TOGGLE.hide });

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu", exact: true });

const menuDialog = (page: Page) => page.getByRole("dialog", { name: "Menu", exact: true });

const jumpToOf = (page: Page) => headerOf(page).getByRole("button", { name: JUMP_TO.name });

const tabsOf = (page: Page) =>
  page.getByRole("tablist", {
    name: pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name,
  });

const modelChoicesCardOf = (page: Page) => page.getByRole("region", { name: "Model Choices" });

const modelChoicesLoaded = (page: Page) =>
  expect(modelChoicesCardOf(page).getByRole("paragraph")).toHaveCount(3);

const notFoundHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading });

const jumpToDialogOf = (page: Page) => page.getByRole("dialog", { name: JUMP_TO.name });

const jumpToOptionOf = (page: Page, name: string | RegExp) =>
  jumpToDialogOf(page).getByRole("option", { name });

const boxOf = async (region: Locator) => {
  const box = await region.boundingBox();
  if (box === null) throw new Error("the region is not rendered");
  return box;
};

const topOf = async (region: Locator): Promise<number> => (await boxOf(region)).y;

const pageWidths = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

const expectNoSidewaysScroll = async (page: Page, when: string) => {
  const widths = await pageWidths(page);
  expect(widths.scrollWidth, `the page scrolls sideways ${when}`).toBeLessThanOrEqual(
    widths.clientWidth,
  );
};

const mainFollowsHeaderWithNoPositiveTabindex = () => {
  const header = document.querySelector("header");
  const content = document.querySelector("main");
  if (header === null || content === null) return false;
  const following = header.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING;
  const positiveTabindex = [...document.querySelectorAll("[tabindex]")].some(
    (element) => Number(element.getAttribute("tabindex")) > 0,
  );
  return following !== 0 && !positiveTabindex;
};

const inDocumentOrder = async (page: Page, regions: readonly Locator[]): Promise<boolean> => {
  const nodes = await Promise.all(regions.map((region) => region.elementHandle()));
  return page.evaluate(
    (elements) =>
      elements.every(
        (node, at) =>
          at === 0 ||
          ((elements[at - 1]?.compareDocumentPosition(node) ?? 0) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    nodes,
  );
};

const signInToNewWorkspace = async (
  page: Page,
  api: Parameters<typeof provision>[0],
  name: string,
) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

const openModelsAndSpendAtNarrowWidth = async (
  page: Page,
  api: Parameters<typeof provision>[0],
  name: string,
) => {
  await signInToNewWorkspace(page, api, name);
  await page.setViewportSize(NARROW);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: MODELS_HEADING })).toBeVisible();
};

const provisionWithTwoMembers = async (
  api: APIRequestContext,
  name: string,
  adminEmail: string,
) => {
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

const breakModelChoicesList = async (route: Route) => {
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
        procedures[index] === MODEL_CHOICES_LIST ? { result: { data: MALFORMED_LIST } } : answer,
      )
    : { result: { data: MALFORMED_LIST } };
  await route.fulfill({ json: broken });
};

test("the shell's header, rail, and menu work by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("shell");
  const workspace = await provisionWithTwoMembers(request, "Wharfedale Castings", email);

  await test.step("an unknown page shows a signed-out visitor only Sign In", async () => {
    await page.goto(UNKNOWN_PATH);

    await expect(notFoundHeading(page)).toBeVisible();
    await expect(headerOf(page)).toHaveText("better-answers", { useInnerText: true });
    await expect(page.getByRole("main").getByRole("link")).toHaveText([UNKNOWN_PAGE.signIn]);
    await expect(page).toHaveURL(UNKNOWN_PATH);
    await passesTheAccessibilityGate();

    await page.getByRole("link", { name: UNKNOWN_PAGE.signIn }).click();
    await expect(signInHeading(page)).toBeVisible();
  });

  await page.goto(MODELS_AND_SPEND.path);
  await signIn(page, request, email);
  await expect(page).toHaveURL(new RegExp(`${MODELS_AND_SPEND.path}$`));

  await test.step("Tab reaches each shell control in document order", async () => {
    const rail = railOf(page);
    await expect(rail.getByRole("link", { name: "Control Centre" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await modelChoicesLoaded(page);

    const headerControls = [
      logoOf(page),
      switcherOf(page, workspace.name),
      hideMenuButton(page),
      crumbOf(page, "Control Centre"),
      crumbOf(page, "Models"),
      crumbOf(page, pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name),
      jumpToOf(page),
      avatarOf(page, workspace.admin.name),
    ];
    expect(
      await inDocumentOrder(page, headerControls),
      "the header's controls are out of document order",
    ).toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: SKIP_TO_MAIN })).toBeFocused();

    for (const stop of headerControls) {
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
    await expect(offer.getByRole("link", { name: SETUP_WORDS.addPasskey })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(offer.getByRole("button", { name: PASSKEY_WORDS.dismissOffer })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(tabsOf(page).getByRole("tab", { name: "Model Choices" })).toBeFocused();

    const panel = page.getByRole("tabpanel");
    await page.keyboard.press("Tab");
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("region", { name: "Model Choices" })).toBeVisible();

    expect(
      await page.evaluate(mainFollowsHeaderWithNoPositiveTabindex),
      "the main content precedes the header or a control has a positive tabindex",
    ).toBe(true);
  });

  await test.step("passes the accessibility gate with the workspace switcher menu open", async () => {
    await switcherOf(page, workspace.name).click();
    await expect(switcherMenuOf(page, workspace.name)).toBeVisible();
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(switcherMenuOf(page, workspace.name)).toHaveCount(0);
  });

  await test.step("opens the Jump To list within one second", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: MODELS_HEADING })).toBeVisible();

    await clockTheNextDraw(page, { at: "//*[@role='dialog']", reads: TOM });
    await page.keyboard.press("Meta+k");
    const elapsed = await actionClocked(page);
    test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
    expect(elapsed, "the Jump To list took longer than one second to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(jumpToDialogOf(page).getByRole("group", { name: "Pages" })).toBeVisible();
    await expect(jumpToOptionOf(page, new RegExp(PRIYA))).toBeVisible();
    await expect(jumpToOptionOf(page, INVITE_A_PERSON.name)).toBeVisible();
  });

  await page.route("**/trpc/**", breakModelChoicesList);
  await page.goto(MODELS_AND_SPEND.path);
  const failed = page.getByRole("heading", { level: 1, name: FAILED_HEADING });
  const navigation = page.getByRole("navigation", { name: "Control Centre" });

  await test.step("a load error leaves the shell usable by keyboard", async () => {
    await expect(page.getByRole("alert").filter({ has: failed })).toBeVisible();
    await expect(page.getByRole("alert").getByRole("paragraph")).toHaveText(/\S/);
    await expect(page.getByRole("link", { name: "Go to Members" })).toHaveAttribute(
      "href",
      HOMES.Admin.path,
    );
    const body = page.locator("body");
    await expect(body).not.toContainText("TypeError");
    await expect(body).not.toContainText("is not a function");

    await expect(headerOf(page).getByText(workspace.name)).toBeVisible();
    await expect(railOf(page).getByRole("link")).toHaveText(AREA_NAMES);
    await expect(
      navigation.getByRole("link", {
        name: pageById(menuGroupIn(CONTROL_CENTRE, "system"), "audit-log").name,
      }),
    ).toBeVisible();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tab", { name: "Model Choices" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: FAILED_PAGE.retry })).toBeFocused();

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
    await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test("never scrolls sideways at 320 px, menu open or closed", async ({ page, request }) => {
  await openModelsAndSpendAtNarrowWidth(page, request, "Acme Joinery");

  await expectNoSidewaysScroll(page, "with the menu closed");

  const headerTop = await topOf(headerOf(page));
  const mainTop = await topOf(page.getByRole("main"));
  expect(headerTop, "the header is not above the main content").toBeLessThan(mainTop);

  await menuButton(page).click();
  await expect(menuDialog(page)).toBeVisible();

  await expectNoSidewaysScroll(page, "with the menu open");
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

type FocusStyle = {
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

const focusStyleOf = (page: Page, edge: string): Promise<FocusStyle | undefined> =>
  page.evaluate((ringColour) => {
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
    // transparent shadow colourLayers, which the filter below drops.
    const ringElements = [focused, ...focused.querySelectorAll<HTMLElement>("*")].filter(
      (element) => getComputedStyle(element).boxShadow.includes(ringColour),
    );
    const ringElement = ringElements[0] ?? focused;
    const shadow = getComputedStyle(ringElement)
      .boxShadow.split(/,(?![^(]*\))\s*/)
      .filter((layer) => !layer.startsWith("rgba(0, 0, 0, 0)"))
      .join(", ");
    const colourLayers = (painted: string) => {
      const colours = painted.match(/rgba?\([^)]+\)/g) ?? [];
      return { ring: colours[0] ?? "", edge: colours.at(-1) ?? "" };
    };
    const behind = surfaceBehind(ringElement);
    const own = getComputedStyle(ringElement).backgroundColor;
    const fill = [own, behind].find(opaque);
    const again = focused.dataset["focusVisited"] === "";
    focused.dataset["focusVisited"] = "";
    const label = focused.getAttribute("aria-label") ?? focused.textContent;
    return {
      again,
      rings: ringElements.length,
      name: `${focused.tagName.toLowerCase()} "${label.trim().slice(0, 40)}"`,
      shadow,
      ...colourLayers(shadow),
      fill: fill ?? behind,
      behind,
    };
  }, edge);

const focusRingColour = async (page: Page): Promise<string> =>
  (await tokenPainted(page, "--focus-ring", "box-shadow")).match(/rgba?\([^)]+\)/g)?.at(-1) ?? "";

const focusStylesByTab = async (page: Page): Promise<readonly FocusStyle[]> => {
  const edge = await focusRingColour(page);
  const styles: FocusStyle[] = [];
  for (let stop = 0; stop < STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    await focusSettled(page);
    const style = await focusStyleOf(page, edge);
    if (style?.again === true) return styles;
    if (style !== undefined) styles.push(style);
  }
  throw new Error(
    `focus did not return to a visited control within ${String(STOPS)} Tab presses, so later controls went unchecked`,
  );
};

const expectStandardFocusRings = async (
  page: Page,
  stops: readonly FocusStyle[],
): Promise<void> => {
  const token = await tokenPainted(page, "--focus-ring", "box-shadow");
  expect(stops.length, "Tab reached fewer than three controls").toBeGreaterThan(2);
  for (const stop of stops) {
    expect(stop.rings, `${stop.name} shows ${String(stop.rings)} focus rings, not one`).toBe(1);
    expect(stop.shadow, `${stop.name} has a focus ring colour other than --focus-ring`).toBe(token);
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

test("shows the standard focus ring on every Members page control", async ({ page, request }) => {
  const email = anAddress("focus");
  await provision(request, { name: "Calder Joinery", adminEmail: email });
  await signedInAtHome(page, request, email);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await skipLinkReachesThePage(page);

  await expectStandardFocusRings(page, await focusStylesByTab(page));
});

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  const workspace = await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await signOutFromTheShell(page, workspace.admin.name);

  const signedOut = await signInStatusText(page);

  await page.goto("/people");
  await expect(signInHeading(page)).toBeVisible();
  await expect(
    page.getByRole("status"),
    "the sign-in status after visiting /people differs from the sign-out status",
  ).toHaveText(signedOut);
});
