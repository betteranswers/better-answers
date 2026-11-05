import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { FIRST_PAINT } from "@better-answers/schema/theme";

import { PAGE_STYLE, serveFaces } from "../../src/auth/page-style.ts";
import { consentPage, REFUSAL_PAGES, refusedPage, signInPage } from "../../src/auth/pages.ts";

const CONSENTING = {
  clientName: "Claude",
  hostedAt: "claude.ai",
  sendsCodeTo: "claude.ai",
  workspace: "Acme",
  workspaceId: "acme-workspace",
  scopes: ["knowledge:read", "feedback:write", "offline_access"],
};

const variablesRead = (sheet: string): readonly string[] =>
  [...new Set([...sheet.matchAll(/var\((--[\w-]+)\)/g)].map(([, name]) => name ?? ""))].sort();

const variablesDeclared = (sheet: string): ReadonlySet<string> =>
  new Set([...sheet.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name ?? ""));

describe("the api pages' stylesheet", () => {
  it("inlines every design-system import", () => {
    expect(PAGE_STYLE).not.toContain("@import");
    expect(PAGE_STYLE).toContain("[data-marks]::before");
    expect(PAGE_STYLE).toContain("--surface-page:");
  });

  it("declares every custom property it reads", () => {
    const declared = variablesDeclared(PAGE_STYLE);
    expect(variablesRead(PAGE_STYLE).filter((name) => !declared.has(name))).toEqual([]);
  });

  it("loads both fonts from the API's own font routes", () => {
    expect(PAGE_STYLE).toContain("url(/fonts/geist/geist-latin-wght-normal.woff2)");
    expect(PAGE_STYLE).toContain("url(/fonts/geist-mono/geist-mono-latin-wght-normal.woff2)");
    expect(PAGE_STYLE).not.toContain("url(./files/");
  });
});

describe("the consent page", () => {
  const html = consentPage("?sig=s", CONSENTING);

  it("puts data-marks on its card and its Connect button", () => {
    expect(html).toContain('<div data-slot="card" data-marks>');
    expect(html).toContain(
      '<button type="submit" data-variant="default" data-marks>Connect</button>',
    );
    expect(html).toContain('<button type="submit" data-variant="outline">Cancel</button>');
  });
});

describe("the person's saved theme", () => {
  const pages = {
    consent: consentPage("?sig=s", CONSENTING),
    refused: refusedPage(REFUSAL_PAGES.crossSite),
    signIn: signInPage(REFUSAL_PAGES.sessionEnded, "?sig=s"),
  };

  it.each(Object.entries(pages))("is applied by the web's script on the %s page", (_name, html) => {
    const script = `<script>${FIRST_PAINT}</script>`;
    expect(html.split(script)).toHaveLength(2);
    expect(html.indexOf(script)).toBeLessThan(html.indexOf("<style>"));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf("</head>"));
  });

  it("is applied by a script that contains no </ sequence", () => {
    expect(FIRST_PAINT).not.toContain("</");
  });
});

describe("the font routes", () => {
  const server = new Hono();
  serveFaces(server);

  it("serve a font file the stylesheet names", async () => {
    const answered = await server.request("/fonts/geist/geist-latin-wght-normal.woff2");
    expect(answered.status).toBe(200);
    expect(answered.headers.get("content-type")).toBe("font/woff2");
  });

  it("answer 404 for a font file the package lacks", async () => {
    const answered = await server.request("/fonts/geist/nothing-here.woff2");
    expect(answered.status).toBe(404);
  });
});
