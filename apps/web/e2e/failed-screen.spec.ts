import { expect, test } from "./browser.ts";
import { anAddress, provision, seedRoutes, signIn, skipLinkReachesTheScreen } from "./harness.ts";

const NOT_A_LIST = { why: "the api answered a shape the routes card cannot render" };

const ROUTES_LIST = "routes.list";

test("a screen that throws leaves the frame, the navigation and an accessible way out", async ({
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

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("region", { name: "You" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link")).toHaveCount(6);

  await skipLinkReachesTheScreen(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try this screen again" })).toBeFocused();

  await passesTheAccessibilityGate();

  /* jscpd:ignore-start */
  await navigation.getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await expect(page.getByText("This view is not built yet.")).toBeVisible();
  /* jscpd:ignore-end */
  await expect(page.getByRole("alert")).toHaveCount(0);
});
