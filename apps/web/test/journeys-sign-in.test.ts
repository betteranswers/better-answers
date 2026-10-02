// @vitest-environment node

import { describe, expect, it } from "vitest";

import { journeysOver, moduleAt } from "./playwright-tree.ts";

/** The sign-in screen in the product's words, keeping the one behaviour the helper leans on: six digits submit. */
const STAND_IN = String.raw`
import { expect, test } from "@playwright/test";
import { SIGN_IN_WORDS } from ${moduleAt("src/features/auth/sign-in-words.ts")};
import { playsTheRole } from ${moduleAt("journeys/outcome.ts")};
import { signIn } from ${moduleAt("journeys/sign-in.ts")};

const CODE = "305117";
const ADDRESS = "admin@journeys.example";

const SCREEN =
  '<!doctype html><html lang="en"><title>Sign in</title><main>' +
  "<label>" + SIGN_IN_WORDS.emailField + ' <input type="email"></label>' +
  '<button id="send">' + SIGN_IN_WORDS.send + "</button>" +
  '<label id="step" hidden>' + SIGN_IN_WORDS.codeField + ' <input id="code"></label>' +
  "<script>" +
  'document.getElementById("send").onclick = async () => {' +
  '  const sent = await fetch("/email-otp/send-verification-otp", { method: "POST" });' +
  '  if (sent.ok) document.getElementById("step").hidden = false;' +
  "};" +
  'document.getElementById("code").oninput = async ({ target }) => {' +
  "  if (target.value.length !== 6) return;" +
  '  const signedIn = await fetch("/sign-in/email-otp", { method: "POST", body: target.value });' +
  '  if (signedIn.ok) document.getElementById("step").remove();' +
  "};" +
  "</script></main></html>";

const theScreen = async (page, answers = {}) => {
  const sends = [];
  await page.route((url) => url.pathname === "/", (route) =>
    route.fulfill({
      status: answers.challenged ? 403 : 200,
      headers: answers.challenged ? { "cf-mitigated": "challenge" } : {},
      contentType: "text/html",
      body: SCREEN,
    }),
  );
  await page.route("**/email-otp/send-verification-otp", (route) => {
    sends.push(route.request().url());
    return route.fulfill({ status: answers.send ?? 200, body: "{}" });
  });
  await page.route("**/sign-in/email-otp", (route) =>
    route.fulfill({ status: route.request().postData() === CODE ? 200 : 400, body: "{}" }),
  );
  return sends;
};

const inboxAnswering = (...answers) => async () => ({
  answer: "noted",
  codeSent: async () => answers.shift(),
});

const signsIn = (scenario, source, answers) =>
  test(scenario, async ({ page }) => {
    playsTheRole(scenario);
    await theScreen(page, answers);
    await signIn(page, ADDRESS, source);
  });
`;

describe("the journeys' sign-in", () => {
  it("signs in through the screen, pressing Send once", async () => {
    const run = await journeysOver({
      spec: [
        STAND_IN,
        'test("signs in", async ({ page }) => {',
        '  playsTheRole("Admin");',
        "  const sends = await theScreen(page);",
        '  await signIn(page, ADDRESS, inboxAnswering({ answer: "code", code: CODE }));',
        "  expect(sends).toHaveLength(1);",
        "});",
        "",
      ].join("\n"),
      use: { baseURL: "http://journeys.test" },
    });

    expect(run.outcome).toBe("held\n");
  }, 120_000);

  it("tells what could not run from what failed", async () => {
    const run = await journeysOver({
      spec: [
        STAND_IN,
        'signsIn("ceiling", inboxAnswering({ answer: "code", code: CODE }), { send: 429 });',
        'signsIn("refusal", inboxAnswering({ answer: "code", code: CODE }), { send: 403 });',
        'signsIn("challenge", inboxAnswering({ answer: "code", code: CODE }), { challenged: true });',
        'signsIn("unnoted", async () => ({ answer: "unreachable" }), {});',
        'signsIn("no-mail", inboxAnswering({ answer: "no-mail" }), {});',
        'signsIn("ambiguous", inboxAnswering({ answer: "ambiguous" }), {});',
        'const firstCode = { answer: "code", code: "111111" };',
        'signsIn("rotated", inboxAnswering(firstCode, { answer: "ambiguous" }), {});',
        'signsIn("refused", inboxAnswering(firstCode, firstCode), {});',
        "",
      ].join("\n"),
      use: { baseURL: "http://journeys.test" },
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      [
        "| could-not-run | ceiling | Sign in | Send the code | a rate ceiling refused the Send |",
        "| could-not-run | refusal | Sign in | Send the code | the edge refused the Send |",
        "| could-not-run | challenge | Sign in | Send the code | the edge challenged the sign-in screen |",
        "| could-not-run | unnoted | Sign in | Note the test inbox | the test inbox did not answer |",
        "| fail | no-mail | Sign in | Read the code from the test inbox |  |",
        "| could-not-run | ambiguous | Sign in | Read the code from the test inbox | the test inbox held more than one new sign-in email, or one that failed authentication |",
        "| could-not-run | rotated | Sign in | Enter the code | another Send rotated the code before it was entered |",
        "| fail | refused | Sign in | Enter the code |  |",
        "",
      ].join("\n"),
    );
  }, 120_000);
});
