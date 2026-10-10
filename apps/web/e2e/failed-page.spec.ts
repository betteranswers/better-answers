import { FAILED_PAGE, goHome, RAIL, ROLE_UNREAD } from "@/app/words.ts";
import { CONTROL_CENTRE, HOMES, KNOWLEDGE } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  seedModelChoices,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";

const NOT_A_LIST = { why: "the api answered a shape the model choices card cannot render" };

const MODEL_CHOICES_LIST = "modelChoices.list";

test("offers a way out, shell intact, when a page throws", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("failed-page");
  const workspace = await provision(request, { name: "Wharfedale Castings", adminEmail: email });
  await seedModelChoices(request, {
    workspaceId: workspace.workspaceId,
    modelChoices: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
  });

  await page.route("**/trpc/**", async (route) => {
    const answered = await route.fetch();
    const procedures = decodeURIComponent(new URL(route.request().url()).pathname)
      .replace("/trpc/", "")
      .split(",");
    if (!procedures.includes(MODEL_CHOICES_LIST)) {
      await route.fulfill({ response: answered });
      return;
    }
    const answers: unknown = await answered.json();

    const broken = Array.isArray(answers)
      ? answers.map((answer, index) =>
          procedures[index] === MODEL_CHOICES_LIST ? { result: { data: NOT_A_LIST } } : answer,
        )
      : { result: { data: NOT_A_LIST } };
    await route.fulfill({ json: broken });
  });

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto("/models/models-and-spend");

  await expect(page.getByRole("heading", { level: 1, name: FAILED_PAGE.heading })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(FAILED_PAGE.said);
  const home = HOMES.Admin;
  await expect(page.getByRole("link", { name: goHome(home) })).toHaveAttribute("href", home.path);
  const everything = page.locator("body");
  await expect(everything).not.toContainText("TypeError");
  await expect(everything).not.toContainText("is not a function");

  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  await expect(page.getByRole("navigation", { name: RAIL }).getByRole("link")).toHaveText([
    KNOWLEDGE.name,
    CONTROL_CENTRE.name,
  ]);
  const navigation = page.getByRole("navigation", { name: CONTROL_CENTRE.name });
  await expect(navigation.getByRole("link", { name: "Audit log" })).toBeVisible();

  await skipLinkReachesThePage(page);
  // The tabs lead the content, then the open tab's panel, so the way out is the stop after it.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Model choices" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: FAILED_PAGE.retry })).toBeFocused();

  await passesTheAccessibilityGate();

  // The toolbar stands too, and its other tab is a way back in: the page is asked again.
  await expect(page.getByRole("tab", { name: "Model choices" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Spend" }).click();
  await expect(page.getByText("Spend is not built yet.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await navigation.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("shows the failed read at the index, then goes home", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("unread");
  await provision(request, { name: "Nidderdale Forge", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  // Batched with whatever else the shell asks, so the read is found by name anywhere in the path.
  const theMemberRead = (url: URL) => url.pathname.includes("session.member");
  await page.route(theMemberRead, (route) => route.abort());
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: FAILED_PAGE.heading })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(ROLE_UNREAD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: RAIL }).getByRole("link")).toHaveCount(0);
  await passesTheAccessibilityGate();

  await page.unroute(theMemberRead);
  await page.getByRole("button", { name: FAILED_PAGE.retry }).click();
  await landedAtHome(page, "Admin");
});
