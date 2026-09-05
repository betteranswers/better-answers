import { expect, test } from "./browser.ts";
import {
  anAddress,
  passesTheAccessibilityGate,
  provision,
  seedRoutes,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

/**
 * A screen that throws over the served build: the frame stands, the navigation still works,
 * and what a reader is left with passes axe.
 *
 * **How the screen is made to throw.** Every screen the product has today handles a read
 * that was refused — the routes card says so in words, and the shell sends a person whose
 * session has ended back to sign-in — so a revocation reaches a handled state and never the
 * boundary. What is not handled, because no screen can defend against it, is an answer of
 * the wrong *shape*: the card's list arrives as an object, and the card throws while it is
 * being drawn. The lie is told at the network, in the browser, exactly as the component
 * suite tells it (`test/failed-screen.test.tsx`); nothing test-only is built into the app,
 * and the bundle under test is the production build the api serves.
 */

/** What the api never sends and the card cannot render: an object where the list should be. */
const NOT_A_LIST = { why: "the api answered a shape the routes card cannot render" };

const ROUTES_LIST = "routes.list";

test("a screen that throws leaves the frame, the navigation and an accessible way out", async ({
  page,
  request,
}) => {
  const email = anAddress("failed-screen");
  const workspace = await provision(request, { name: "Wharfedale Castings", adminEmail: email });
  await seedRoutes(request, {
    workspaceId: workspace.workspaceId,
    routes: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
  });

  // The api's own answer is fetched and then edited, so every other procedure in the batch —
  // the shell's membership read among them — arrives exactly as the server wrote it.
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
    // Batched calls answer as an array in the order the path names them; a lone call answers
    // as one object. Both shapes reach here, because batching depends on what a screen asks
    // for in one tick and is not this test's to pin.
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

  // What happened, and nothing of what threw: no message, no name, no stack.
  await expect(
    page.getByRole("heading", { level: 1, name: "This screen could not be shown" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("failed while it was being drawn");
  const everything = page.locator("body");
  await expect(everything).not.toContainText("TypeError");
  await expect(everything).not.toContainText("is not a function");

  // The frame is still the frame: its three landmarks, and the person it says is reading.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("region", { name: "You" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link")).toHaveCount(6);

  // The way out is reachable by keyboard: the skip link, then the screen region, then the
  // first control in it. Nothing between the reader and the retry needs a mouse.
  await skipLinkReachesTheScreen(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Try this screen again" })).toBeFocused();

  // The rest of what a reader is left with: the keyboard traversal above is the other half.
  await passesTheAccessibilityGate(page);

  // The navigation still navigates, which is the whole point of the boundary sitting inside
  // the outlet: one screen is lost and the other five are read as usual. Eight lines the
  // frame's own spec also walks, carried rather than folded: there it is the claim, here it
  // is what has to still be true after a screen threw, and a helper would leave neither
  // reader able to see what the other test meant.
  /* jscpd:ignore-start */
  await navigation.getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await expect(page.getByText("This screen is not built yet.")).toBeVisible();
  /* jscpd:ignore-end */
  await expect(page.getByRole("alert")).toHaveCount(0);
});
