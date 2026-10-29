import type { Route } from "@playwright/test";
import { z } from "zod";

import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  provision,
  seedModelChoices,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";

const NOT_A_LIST = { why: "the api answered a shape the model choices card cannot render" };

const MODEL_CHOICES_LIST = "modelChoices.list";

const FAILED_HEADING = "This Page Didn’t Load";

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

  await page.route("**/trpc/**", modelChoicesBroken);

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
    "Ask",
    "Knowledge",
    "Inbox",
    "Control Centre",
  ]);
  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link", { name: "Audit Log" })).toBeVisible();

  await skipLinkReachesThePage(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Model Choices" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try Again" })).toBeFocused();

  await passesTheAccessibilityGate();

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
