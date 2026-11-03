import type { APIRequestContext } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import {
  anAuditWorkspace,
  answered,
  askButton,
  collectionIn,
  DRAFTED,
  DRAFTING,
  POLICY,
  QUESTION,
  questionBox,
} from "../asking.ts";
import { expect, test } from "../browser.ts";
import { railOf, releaseTheModel, scriptAsking, signIn } from "../harness.ts";

const QUESTIONS_ASKED = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Questions Asked");

const aWorkspaceToAsk = async (api: APIRequestContext) => {
  const audits = await anAuditWorkspace(api);
  await scriptAsking(api, {
    workspaceId: audits.workspaceId,
    judging: { fits: [] },
    drafting: DRAFTING,
    holds: "draft",
  });
  return audits;
};

test("a drafted sentence streams in, then its flag is stored", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspaceId, adminEmail } = await aWorkspaceToAsk(request);
  await page.goto("/sign-in");
  await signIn(page, request, adminEmail);
  await railOf(page).getByRole("link", { name: "Ask" }).click();
  const audits = collectionIn(answered(page, "Related Knowledge"), "audits");

  await test.step("shows the first drafted sentence before the stream ends", async () => {
    await questionBox(page).fill(QUESTION);
    const started = Date.now();
    await questionBox(page).press("Enter");
    await expect(audits.getByText(DRAFTED)).toBeVisible();
    const elapsed = Date.now() - started;

    test
      .info()
      .annotations.push({ type: "first sentence, streamed", description: `${elapsed} ms` });
    await expect(askButton(page), "the stream had ended").toHaveAttribute("aria-disabled", "true");
    await expect(audits.getByRole("button", { name: `Cites ${POLICY.title}` })).toBeVisible();
    await releaseTheModel(request, workspaceId);
    await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await passesTheAccessibilityGate();
  });

  await test.step("flags one drafted sentence, storing it and its concept", async () => {
    await audits.getByRole("button", { name: `Flag “${DRAFTED}”` }).click();
    const flagging = page.getByRole("dialog", { name: `Flag “${DRAFTED}”` });
    await flagging.getByRole("radio", { name: "Wrong" }).check();
    const sending = page.waitForResponse((response) => response.url().includes("ask.giveFeedback"));
    await flagging.getByRole("button", { name: "Send Flag" }).click();
    await expect(audits.getByRole("button", { name: "Flagged" })).toBeVisible();
    expect((await sending).ok(), "the flag was not stored").toBe(true);

    await page.goto(QUESTIONS_ASKED.path);
    await page
      .getByRole("region", { name: "Flagged" })
      .getByRole("button", { name: QUESTION })
      .click();
    const record = page.getByRole("dialog", { name: QUESTION });
    await expect(record.getByText(/Wrong/)).toBeVisible();
    await expect(record.getByRole("blockquote")).toHaveText(DRAFTED);
    await expect(record.getByRole("link", { name: POLICY.title })).not.toHaveCount(0);
  });
});
