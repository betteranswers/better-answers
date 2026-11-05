import type { APIRequestContext, Page } from "@playwright/test";

import { RECOVERY_CODES_IN_A_SET } from "@better-answers/schema/second-factor";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  keyShown,
  landedAtHome,
  person,
  provision,
  signedInAtHome,
  signInByEmail,
  withAnAuthenticator,
} from "../harness.ts";
import { openAccountFromPersonMenu, codesListed, regionOf } from "../second-factor-steps.ts";

const MEMBERS = HOMES.Admin.path;

const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{4}(?:-[0-9a-hjkmnp-tv-z]{4}){3}$/;

const confirmHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Confirm It’s You" });

const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

const currentUrl = (page: Page): URL => new URL(page.url());

const recoveryCodesRegion = (page: Page) => regionOf(page, "Save Your Recovery Codes");

const setUpButton = (page: Page) =>
  page.getByRole("button", { name: "Set Up an Authenticator", exact: true });

const removeButton = (page: Page) =>
  regionOf(page, "Authenticator").getByRole("button", { name: "Remove", exact: true });

const shownStatus = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

const recoveryCodeItems = Array.from(
  { length: RECOVERY_CODES_IN_A_SET },
  () => `          - listitem: ${String(RECOVERY_CODE)}`,
).join("\n");

const signInToConfirm = async (page: Page, api: APIRequestContext, email: string) => {
  const key = await withAnAuthenticator(api, email);
  await page.goto("/sign-in");
  await signInByEmail(page, api, email);
  await expect(confirmHeading(page)).toBeVisible();
  return key;
};

test("Admins confirm before Members opens, and Editors add an authenticator", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Calder Joinery" });
  const editorAddress = anAddress("editor");
  const editor = await person(request, editorAddress, { displayName: "Ines Editor" });
  await addMember(request, {
    role: "Editor",
    userId: editor.id,
    workspaceId: workspace.workspaceId,
  });

  await test.step("an Admin enters an authenticator code before Members opens", async () => {
    const key = await signInToConfirm(page, request, workspace.admin.email);

    await page.goto(MEMBERS);

    await expect(confirmHeading(page)).toBeVisible();
    expect(`${currentUrl(page).pathname}${currentUrl(page).search}`).toBe(
      `/confirm?redirect=${encodeURIComponent(MEMBERS)}`,
    );
    await expect(codeField(page)).toBeFocused();
    await codeField(page).fill(authenticatorCodeAt(key, new Date()));
    await landedAtHome(page, "Admin");
    await passesTheAccessibilityGate();
  });

  await test.step("an Editor sets up an authenticator from the avatar menu", async () => {
    await page.context().clearCookies();
    await signedInAtHome(page, request, editorAddress, "Editor");
    await openAccountFromPersonMenu(page, editor.name);
    await expect(setUpButton(page)).toBeVisible();

    await setUpButton(page).click();
    await expect(
      page.getByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeVisible();
    const key = await keyShown(page);
    await page.getByLabel("Authenticator Code").fill(authenticatorCodeAt(key, new Date()));
    await expect(codesListed(page)).toHaveCount(RECOVERY_CODES_IN_A_SET);
    const codes = await codesListed(page).allInnerTexts();

    expect(
      codes.every((code) => RECOVERY_CODE.test(code)),
      "a recovery code does not match the format the API issues",
    ).toBe(true);
    await expect(
      shownStatus(page),
      "no status appears after setting up the authenticator",
    ).toBeVisible();
    await expect(removeButton(page), "the Authenticator region has no Remove button").toBeVisible();
    await expect(
      recoveryCodesRegion(page).getByRole("heading", { name: "Save Your Recovery Codes" }),
    ).toBeFocused();
    await expect(recoveryCodesRegion(page)).toMatchAriaSnapshot(`
      - region "Save Your Recovery Codes":
        - heading "Save Your Recovery Codes" [level=3]
        - paragraph
        - list "Recovery Codes":
${recoveryCodeItems}
        - button "Copy Codes"
        - link "Download"
        - button "Print"
        - checkbox "I have saved these codes"
        - button "Done"
    `);
  });
});
