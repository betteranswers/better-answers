import { expect, test } from "./browser.ts";
import { anAddress, provision, seedRoutes, signIn, skipLinkReachesTheScreen } from "./harness.ts";

const NOT_A_LIST = { why: "the api answered a shape the routes card cannot render" };

const ROUTES_LIST = "routes.list";

test("a view that throws leaves the three regions standing and an accessible way out", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("failed-screen");
  const workspace = await provision(request, { name: "Wharfedale Castings", adminEmail: email });
  await seedRoutes(request, {
    workspaceId: workspace.workspaceId,
    routes: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
  });

  await page.route("**/trpc/**", async (route) => {
    const answered = await route.fetch();
    const procedures = decodeURIComponent(new URL(route.request().url()).pathname)
      .replace("/trpc/", "")
      .split(",");
    if (!procedures.includes(ROUTES_LIST)) {
      await route.fulfill({ response: answered });
      return;
    }
    const answers: unknown = await answered.json();

    const broken = Array.isArray(answers)
      ? answers.map((answer, index) =>
          procedures[index] === ROUTES_LIST ? { result: { data: NOT_A_LIST } } : answer,
        )
      : { result: { data: NOT_A_LIST } };
    await route.fulfill({ json: broken });
  });

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto("/system");

  await expect(
    page.getByRole("heading", { level: 1, name: "This screen could not be shown" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("failed while it was being drawn");
  const everything = page.locator("body");
  await expect(everything).not.toContainText("TypeError");
  await expect(everything).not.toContainText("is not a function");

  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link")).toHaveCount(6);
  await expect(
    page.getByRole("navigation", { name: "System" }).getByRole("link", { name: "Backups" }),
  ).toBeVisible();

  await skipLinkReachesTheScreen(page);
  // The open tab's panel is the first stop inside the content, so the way out is the next one.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try this screen again" })).toBeFocused();

  await passesTheAccessibilityGate();

  // The toolbar stands too, and its other tab is a way back in: the view is asked again.
  await expect(page.getByRole("tab", { name: "Routes" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Spend" }).click();
  await expect(page.getByText("Spend is not built yet.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  /* jscpd:ignore-start */
  await navigation.getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await expect(page.getByText("This view is not built yet.")).toBeVisible();
  /* jscpd:ignore-end */
  await expect(page.getByRole("alert")).toHaveCount(0);
});
