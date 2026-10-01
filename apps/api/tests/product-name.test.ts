import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";

import { consentPage, REFUSAL_PAGES, refusedPage, signInPage } from "../src/auth/pages.ts";
import { senderAt } from "../src/product-name.ts";

const LOGO = readFileSync(
  path.join(repositoryRoot, "packages/design-system/assets/logo.svg"),
  "utf8",
).trim();

const CONSENTING = {
  clientName: "Claude",
  hostedAt: "claude.ai",
  sendsCodeTo: "claude.ai",
  workspace: "Acme",
  scopes: ["knowledge:read"],
};

const PAGES = [
  { page: "the consent page", html: consentPage("?sig=s", CONSENTING), title: "Connect Claude" },
  {
    page: "a refusal",
    html: refusedPage(REFUSAL_PAGES.notCompleted),
    title: "Nothing was connected",
  },
  {
    page: "a sign-in refusal",
    html: signInPage(REFUSAL_PAGES.signInFirst, "?sig=s"),
    title: "Sign in first",
  },
];

describe("the api's pages", () => {
  it.each(PAGES)("titles $page with the product's name", ({ html, title }) => {
    expect(html).toContain(`<title>${title} — better-answers</title>`);
  });

  it.each(PAGES)("opens $page with the logo beside the name", ({ html }) => {
    expect(html).toContain(
      `<header><span aria-hidden="true">${LOGO}</span>better-answers</header>`,
    );
  });

  it("refuses a cross-site form as sent from elsewhere", () => {
    expect(REFUSAL_PAGES.crossSite.why).toBe("This form can only be sent from better-answers.");
  });
});

describe("the api's emails", () => {
  it("come from better-answers, at the apex's no-reply address", () => {
    expect(senderAt("example.test")).toBe("better-answers <no-reply@example.test>");
  });
});
