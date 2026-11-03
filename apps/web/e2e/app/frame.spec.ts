import type { Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  avatarOf,
  crumbOf,
  keystrokesButton,
  navOf,
  provision,
  railOf,
  signIn,
  switcherOf,
} from "../harness.ts";

const SOURCES = menuGroupIn(CONTROL_CENTRE, "sources");

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and Spend");

const QUESTIONS = menuGroupIn(CONTROL_CENTRE, "questions");

const PEOPLE = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS = pageNamed(PEOPLE, "Members");

const SYSTEM = menuGroupIn(CONTROL_CENTRE, "system");

const AN_ADMINS_PAGES = [
  ["Sources", "Connected Sources", pageNamed(SOURCES, "Connected Sources").path],
  ["Models", "Models and Spend", MODELS_AND_SPEND.path],
  ["Questions", "Questions Asked", pageNamed(QUESTIONS, "Questions Asked").path],
  ["Questions", "Answer Tests", pageNamed(QUESTIONS, "Answer Tests").path],
  ["People", "Members", MEMBERS.path],
  ["People", "Groups", pageNamed(PEOPLE, "Groups").path],
  ["System", "Audit Log", pageNamed(SYSTEM, "Audit Log").path],
] as const;

const AREA_NAMES = ["Ask", "Knowledge", "Inbox", "Control Centre"];

const PAGE_NAMES = AN_ADMINS_PAGES.map(([, name]) => name);

const ITS_HEADING = "Models";

const NARROW = { width: 320, height: 720 };

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

const signedInAtModelsAndSpend = async (
  page: Page,
  api: Parameters<typeof provision>[0],
  name: string,
) => {
  const email = anAddress("shell");
  const workspace = await provision(api, { name, adminEmail: email });
  await page.goto(MODELS_AND_SPEND.path);
  await signIn(page, api, email);
  await expect(page).toHaveURL(new RegExp(`${MODELS_AND_SPEND.path}$`));
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

test("tabs skip link, band, icon rail, menu, toolbar, page", async ({ page, request }) => {
  const workspace = await signedInAtModelsAndSpend(page, request, "Dales Engineering");
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
  expect(await inDocumentOrder(page, band), "the band reads out of order").toBe(true);

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

test("scrolls nothing sideways at 320 pixels, navigation open or closed", async ({
  page,
  request,
}) => {
  await narrowAtModelsAndSpend(page, request, "Acme Joinery");

  await scrollsNothingSideways(page, "with the sheet closed");

  const bar = await topOf(bandOf(page));
  const content = await topOf(page.getByRole("main"));
  expect(bar).toBeLessThan(content);

  await sheetButtonOf(page).click();
  await expect(sheetOf(page)).toBeVisible();

  await scrollsNothingSideways(page, "with the sheet open");
});

const leadingLineOf = async (page: Page, heading: string, name: string, path: string) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const lead = page.getByRole("main").locator("h1 + p");
  await expect(lead, `${name}'s heading leads no line`).toHaveText(/\S/);
  return lead.innerText();
};

for (const group of new Set(AN_ADMINS_PAGES.map(([heading]) => heading))) {
  test(`leads the ${group} group's pages with one line, auditing each`, async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedIn(page, request, "Swaledale Foundry");

    const lines = new Set<string>();
    for (const [heading, name, path] of AN_ADMINS_PAGES.filter(([of]) => of === group)) {
      lines.add(await leadingLineOf(page, heading, name, path));
      expect(lines.size, `${name} leads with a line of its own`).toBe(1);
      await passesTheAccessibilityGate();
    }
  });
}
