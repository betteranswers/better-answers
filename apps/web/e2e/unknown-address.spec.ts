import type { Page } from "@playwright/test";

import { ASK } from "@/shared/navigation.ts";

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

const NOT_FOUND = "Page Not Found";

const notFound = (page: Page) => page.getByRole("heading", { level: 1, name: NOT_FOUND });

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
  await expect(page.getByRole("banner")).toHaveText("better-answers", { useInnerText: true });
  await expect(page.getByRole("main").getByRole("link")).toHaveText(["Sign In"]);
  await expect(page).toHaveURL(NOWHERE);
  await passesTheAccessibilityGate();

  await page.getByRole("link", { name: "Sign In" }).click();
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
  await expect(crumbOf(page, NOT_FOUND)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.getByRole("link", { name: "Go to Members" }).click();
  await landedAtHome(page, "Admin");
});

test("names a hidden page's absence in the band", async ({ page, request }) => {
  await anAdminAtHome(page, request);
  await page.goto(ASK.home.path);

  await notFoundOfferingHome(page, "Admin");
  await expect(crumbOf(page, NOT_FOUND)).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Go to Members" }),
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
  await expect(page.getByRole("banner")).toHaveText("better-answers", { useInnerText: true });
  await expect(railOf(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link")).toHaveText(["Go to Your Home Page"]);
});
