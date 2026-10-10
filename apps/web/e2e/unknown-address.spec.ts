import type { Page } from "@playwright/test";

import { goHome, UNKNOWN_PAGE } from "@/app/words.ts";
import { ASK, HOMES } from "@/shared/navigation.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  crumbOf,
  landedAtHome,
  notFoundOfferingHome,
  provision,
  railOf,
  signedInAtHome,
  signedInWithNoWorkspace,
  signInHeading,
} from "./harness.ts";

const NOWHERE = "/nothing-here";

const notFound = (page: Page) =>
  page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading });

const anAdminAtHome = async (page: Page, request: Parameters<typeof provision>[0]) => {
  const email = anAddress("admin");
  await provision(request, { name: "Calder Lettering", adminEmail: email });
  await signedInAtHome(page, request, email);
};

test("offers a signed-out visitor the logo and sign-in", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await page.goto(NOWHERE);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText(PRODUCT_NAME, { useInnerText: true });
  await expect(page.getByRole("main").getByRole("link")).toHaveText([UNKNOWN_PAGE.signIn]);
  await expect(page).toHaveURL(NOWHERE);
  await passesTheAccessibilityGate();

  await page.getByRole("link", { name: UNKNOWN_PAGE.signIn }).click();
  await expect(signInHeading(page)).toBeVisible();
});

test("draws an unknown address inside a member's shell", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await anAdminAtHome(page, request);
  await page.goto(NOWHERE);

  await notFoundOfferingHome(page, "Admin");
  await expect(railOf(page)).toBeVisible();
  await expect(crumbOf(page, UNKNOWN_PAGE.heading)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.getByRole("link", { name: goHome(HOMES.Admin) }).click();
  await landedAtHome(page, "Admin");
});

test("names a hidden page's absence in the band", async ({ page, request }) => {
  await anAdminAtHome(page, request);
  await page.goto(ASK.home.path);

  await notFoundOfferingHome(page, "Admin");
  await expect(crumbOf(page, UNKNOWN_PAGE.heading)).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: goHome(HOMES.Admin) }),
    "the way home is underlined where no other link is",
  ).toHaveCSS("text-decoration-line", "none");
});

test("draws an unknown address outside the shell without a workspace", async ({
  page,
  request,
}) => {
  await signedInWithNoWorkspace(page, request, "nowhere");
  await page.goto(NOWHERE);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText(PRODUCT_NAME, { useInnerText: true });
  await expect(railOf(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link")).toHaveText([goHome(undefined)]);
});
