import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { PAGE_STYLE, serveFaces } from "../src/auth/page-style.ts";
import { CONSENT_WORDS, consentPage, REFUSAL_PAGES } from "../src/auth/pages.ts";

const CONSENTING = {
  clientName: "Claude",
  hostedAt: "claude.ai",
  sendsCodeTo: "claude.ai",
  workspace: "Acme",
  scopes: ["knowledge:read", "feedback:write", "offline_access"],
};

const variablesRead = (sheet: string): readonly string[] =>
  [...new Set([...sheet.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name ?? ""))].sort();

const variablesDeclared = (sheet: string): ReadonlySet<string> =>
  new Set([...sheet.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name ?? ""));

const everyWordShown = (): readonly string[] => [
  CONSENT_WORDS.title("Claude"),
  CONSENT_WORDS.asYou("Claude", "Acme"),
  CONSENT_WORDS.hostedAt("Claude", "claude.ai"),
  CONSENT_WORDS.goesNext("claude.ai"),
  ...Object.values(CONSENT_WORDS.scopes),
  CONSENT_WORDS.recorded("Claude"),
  CONSENT_WORDS.connect,
  CONSENT_WORDS.cancel,
  ...Object.values(REFUSAL_PAGES).flatMap((page) => Object.values(page)),
];

describe("the api pages' stylesheet", () => {
  it("inlines every design-system import rather than leaving one", () => {
    expect(PAGE_STYLE).not.toContain("@import");
    expect(PAGE_STYLE).toContain("[data-marks]::before");
    expect(PAGE_STYLE).toContain("--surface-page:");
  });

  it("declares every custom property it reads", () => {
    const declared = variablesDeclared(PAGE_STYLE);
    expect(variablesRead(PAGE_STYLE).filter((name) => !declared.has(name))).toEqual([]);
  });

  it("points both faces at this tier's font mounts", () => {
    expect(PAGE_STYLE).toContain("url(/fonts/geist/geist-latin-wght-normal.woff2)");
    expect(PAGE_STYLE).toContain("url(/fonts/geist-mono/geist-mono-latin-wght-normal.woff2)");
    expect(PAGE_STYLE).not.toContain("url(./files/");
  });
});

describe("the consent page", () => {
  const html = consentPage("?sig=s", CONSENTING);

  it("marks its card and its primary button", () => {
    expect(html).toContain('<div data-slot="card" data-marks>');
    expect(html).toContain(
      '<button type="submit" data-variant="default" data-marks>Connect</button>',
    );
    expect(html).toContain('<button type="submit" data-variant="outline">Cancel</button>');
  });

  it("shows no straight quote or apostrophe", () => {
    expect(everyWordShown().filter((words) => /['"]/.test(words))).toEqual([]);
  });
});

describe("the font mounts", () => {
  const server = new Hono();
  serveFaces(server);

  it("serve a face the stylesheet names", async () => {
    const answered = await server.request("/fonts/geist/geist-latin-wght-normal.woff2");
    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-type")).toBe("font/woff2");
  });

  it("pass a name the package lacks to what follows", async () => {
    const answered = await server.request("/fonts/geist/nothing-here.woff2");
    expect(answered.status).toBe(404);
  });
});
