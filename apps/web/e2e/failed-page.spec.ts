import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  saysARefusal,
  seedModelChoices,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";

const NOT_A_LIST = { why: "the api answered a shape the model choices card cannot render" };

const MODEL_CHOICES_LIST = "modelChoices.list";

const FAILED_HEADING = "This Page Didn’t Load";

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

  const failed = page.getByRole("heading", { level: 1, name: FAILED_HEADING });
  await expect(page.getByRole("alert").filter({ has: failed })).toBeVisible();
  await expect(page.getByRole("alert").getByRole("paragraph")).toHaveText(/\S/);
  await expect(page.getByRole("link", { name: "Go to Members" })).toHaveAttribute(
    "href",
    HOMES.Admin.path,
  );
  const everything = page.locator("body");
  await expect(everything).not.toContainText("TypeError");
  await expect(everything).not.toContainText("is not a function");

  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Areas" }).getByRole("link")).toHaveText([
    "Knowledge",
    "Control Centre",
  ]);
  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link", { name: "Audit Log" })).toBeVisible();

  await skipLinkReachesThePage(page);
  // The tabs lead the content, then the open tab's panel, so the way out is the stop after it.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Model Choices" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeFocused();

  await passesTheAccessibilityGate();

  // The toolbar stands too, and its other tab is a way back in: the page is asked again.
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

  await expect(page.getByRole("heading", { level: 1, name: FAILED_HEADING })).toBeVisible();
  await saysARefusal(page.getByRole("alert"));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: "Areas" }).getByRole("link")).toHaveCount(0);
  await passesTheAccessibilityGate();

  await page.unroute(theMemberRead);
  await page.getByRole("button", { name: "Try Again" }).click();
  await landedAtHome(page, "Admin");
});
