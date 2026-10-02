// @vitest-environment node

import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";

import { journeysOver, moduleAt } from "./playwright-tree.ts";

const ADMIN = "admin@journeys.example";
const EDITOR = "editor@journeys.example";
const CODE = "305117";
const SESSION = "session=a-journeys-session";

/** Six digits submit on their own, as the product's screen does. */
const SCREEN = [
  '<!doctype html><html lang="en"><title>Sign in</title><main>',
  `<label>${SIGN_IN_WORDS.emailField} <input type="email"></label>`,
  `<button id="send">${SIGN_IN_WORDS.send}</button>`,
  `<label id="step" hidden>${SIGN_IN_WORDS.codeField} <input id="code"></label>`,
  "<script>",
  'document.getElementById("send").onclick = async () => {',
  '  const sent = await fetch("/email-otp/send-verification-otp", { method: "POST" });',
  '  if (sent.ok) document.getElementById("step").hidden = false;',
  "};",
  'document.getElementById("code").oninput = async ({ target }) => {',
  "  if (target.value.length !== 6) return;",
  '  const signedIn = await fetch("/sign-in/email-otp", { method: "POST", body: target.value });',
  '  if (signedIn.ok) document.getElementById("step").remove();',
  "};",
  "</script></main></html>",
].join("\n");

type Reply = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

type Heard = {
  readonly asked: string;
  readonly headers: IncomingHttpHeaders;
};

type Product = {
  readonly origin: string;
  /** Every request but the browser's favicon, in the order it arrived. */
  readonly heard: readonly Heard[];
};

type Replies = { readonly send?: Reply; readonly signOuts?: readonly Reply[] };

const OK: Reply = { status: 200, body: "{}" };

/** A sign-in opens at `/`, which the product's SPA takes to its sign-in screen. */
const SHOWING_THE_SCREEN = new Set(["GET /", "GET /sign-in"]);

const replyTo = (asked: string, body: string, replies: Replies, signOut: () => Reply): Reply => {
  if (SHOWING_THE_SCREEN.has(asked)) {
    return { status: 200, headers: { "content-type": "text/html" }, body: SCREEN };
  }
  switch (asked) {
    case "POST /email-otp/send-verification-otp":
      return replies.send ?? OK;
    case "POST /sign-in/email-otp":
      return body === CODE
        ? { ...OK, headers: { "set-cookie": `${SESSION}; Path=/; HttpOnly` } }
        : { status: 400, body: "{}" };
    case "GET /__harness/codes":
      return { status: 200, body: JSON.stringify({ code: CODE }) };
    case "POST /sign-out":
      return signOut();
    default:
      return { status: 404 };
  }
};

const bodyOf = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const closers: (() => Promise<void>)[] = [];

/** The product's sign-in screen and posts, the harness's code reader and the sign-out. */
const theProduct = async (replies: Replies = {}): Promise<Product> => {
  const heard: Heard[] = [];
  const signOuts = [...(replies.signOuts ?? [])];
  const server = createServer((request, response) => {
    void bodyOf(request).then((body) => {
      const asked = `${request.method ?? ""} ${new URL(request.url ?? "/", "http://stand-in").pathname}`;
      if (asked !== "GET /favicon.ico") heard.push({ asked, headers: request.headers });
      const reply = replyTo(asked, body, replies, () => signOuts.shift() ?? OK);
      response.writeHead(reply.status, reply.headers);
      response.end(reply.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port to listen on");
  return { origin: `http://127.0.0.1:${String(address.port)}`, heard };
};

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** Every setting a journey reads, as the journeys' step holds them, unset where left empty. */
const SETTINGS = {
  JOURNEYS_CODE_SOURCE: "harness",
  JOURNEYS_ADMIN_EMAIL: ADMIN,
  JOURNEYS_EDITOR_EMAIL: EDITOR,
  JOURNEYS_VIEWER_EMAIL: "",
  JOURNEYS_SENDER: "",
};

const journeyOf = (...lines: readonly string[]): string =>
  [`import { test } from ${moduleAt("journeys/fixtures.ts")};`, ...lines, ""].join("\n");

const AS_THE_ADMIN = [
  'test.describe("as the Admin", () => {',
  '  test.use({ role: "Admin" });',
  '  test("the Admin passes through the screen", async () => {});',
  "});",
];

const AS_THE_EDITOR = [
  'test.describe("as the Editor", () => {',
  '  test.use({ role: "Editor" });',
  '  test("the Editor passes through the screen", async () => {});',
  "});",
];

const journeysAgainst = (product: Product, spec: string, settings: Record<string, string> = {}) =>
  journeysOver({ spec, use: { baseURL: product.origin }, env: { ...SETTINGS, ...settings } });

const SIGNED_IN_AND_OUT = [
  "GET /",
  "POST /email-otp/send-verification-otp",
  "GET /__harness/codes",
  "POST /sign-in/email-otp",
  "POST /sign-out",
];

describe("a journey that names its role", () => {
  let product: Product;
  let run: Awaited<ReturnType<typeof journeysOver>>;

  beforeAll(async () => {
    product = await theProduct();
    run = await journeysAgainst(product, journeyOf(...AS_THE_ADMIN));
  }, 120_000);

  it("signs its person in, then out on the server", () => {
    expect(run.outcome).toBe("held\n");
    expect(product.heard.map(({ asked }) => asked)).toEqual(SIGNED_IN_AND_OUT);
    const signOut = product.heard.at(-1)?.headers;
    expect(signOut?.cookie).toBe(SESSION);
    expect(signOut?.origin).toBe(product.origin);
  });

  it("sends no client address, from the page or the request", () => {
    const addressed = product.heard.filter(({ headers }) => "cf-connecting-ip" in headers);

    expect(product.heard.map(({ asked }) => asked)).toContain("GET /__harness/codes");
    expect(addressed).toEqual([]);
  });
});

describe("the journeys' fixtures", () => {
  it("signs out on the server after a failed sign-in", async () => {
    const product = await theProduct({ send: { status: 500, body: "{}" } });
    const run = await journeysAgainst(product, journeyOf(...AS_THE_ADMIN));

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain("| fail | Admin | Sign in | Send the code |  |\n");
    expect(product.heard.map(({ asked }) => asked).at(-1)).toBe("POST /sign-out");
  }, 120_000);

  it("signs nobody in for a journey without a role", async () => {
    const product = await theProduct();
    const run = await journeysAgainst(
      product,
      journeyOf(
        'test("the preflight opens the sign-in screen", async ({ page }) => {',
        '  await page.goto("/sign-in");',
        "});",
      ),
    );

    expect(run.status).toBe(0);
    expect(product.heard.map(({ asked }) => asked)).toEqual(["GET /sign-in"]);
  }, 120_000);

  it("names a missing address or code source, never an address", async () => {
    const product = await theProduct();
    const run = await journeysAgainst(product, journeyOf(...AS_THE_ADMIN, ...AS_THE_EDITOR), {
      JOURNEYS_ADMIN_EMAIL: "",
      JOURNEYS_CODE_SOURCE: "carrier-pigeon",
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      [
        "| could-not-run | Admin | Read the journeys' settings | Read the journeys' settings | JOURNEYS_ADMIN_EMAIL is not set to an address |",
        "| could-not-run | Editor | Read the journeys' settings | Read the journeys' settings | JOURNEYS_CODE_SOURCE names no code source: set it to inbox or harness |",
      ].join("\n"),
    );
    expect(`${run.summary}${run.stdout}${run.stderr}`).not.toContain(EDITOR);
  }, 120_000);

  it("names a missing sender for the inbox, never an address", async () => {
    const product = await theProduct();
    const run = await journeysAgainst(product, journeyOf(...AS_THE_EDITOR), {
      JOURNEYS_CODE_SOURCE: "inbox",
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      "| could-not-run | Editor | Read the journeys' settings | Read the journeys' settings | JOURNEYS_SENDER is not set |\n",
    );
    expect(`${run.summary}${run.stdout}${run.stderr}`).not.toContain(EDITOR);
  }, 120_000);

  it("tells a sign-out the edge refused from one that failed", async () => {
    const product = await theProduct({
      signOuts: [
        { status: 429, body: "{}" },
        { status: 403, headers: { "cf-mitigated": "challenge" }, body: "" },
        { status: 403, body: "" },
        { status: 500, body: "{}" },
      ],
    });
    const run = await journeysAgainst(
      product,
      journeyOf(
        'test.use({ role: "Admin" });',
        'test("meets a ceiling at the sign-out", async () => {});',
        'test("meets a challenge at the sign-out", async () => {});',
        'test("meets the edge refusing the sign-out", async () => {});',
        'test("meets the product failing the sign-out", async () => {});',
      ),
    );
    const SIGN_OUT = "Sign out on the server | Sign out on the server";

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      [
        `| could-not-run | Admin | ${SIGN_OUT} | a rate ceiling refused the sign-out |`,
        `| could-not-run | Admin | ${SIGN_OUT} | the edge challenged the sign-out |`,
        `| could-not-run | Admin | ${SIGN_OUT} | the edge refused the sign-out |`,
        `| fail | Admin | ${SIGN_OUT} |  |`,
      ].join("\n"),
    );
  }, 120_000);
});

/** The three journeys under their own names, the Admin's ending as `adminEnds` says. */
const theThreeJourneys = (adminEnds: string) => ({
  "admin.spec.ts": journeyOf(
    `import { stopTheRun } from ${moduleAt("journeys/run-stop.ts")};`,
    'test.use({ role: "Admin" });',
    `test("the Admin's journey ends early", async () => { ${adminEnds} });`,
  ),
  "editor.spec.ts": journeyOf(...AS_THE_EDITOR),
  "viewer.spec.ts": journeyOf(
    'test.use({ role: "Viewer" });',
    'test("the Viewer passes through the screen", async () => {});',
  ),
});

const signInsHeard = (product: Product): number =>
  product.heard.filter(({ asked }) => asked === "POST /sign-in/email-otp").length;

describe("a run the Admin's journey stops", () => {
  const ALL_THREE = { JOURNEYS_VIEWER_EMAIL: "viewer@journeys.example" };

  it("signs the Editor and Viewer in nowhere, once stopped", async () => {
    const product = await theProduct();
    const run = await journeysOver({
      specs: theThreeJourneys('stopTheRun("the test workspace holds 1 waiting invitation");'),
      use: { baseURL: product.origin },
      env: { ...SETTINGS, ...ALL_THREE },
    });
    const STOPPED =
      "the Admin's journey found the test workspace changed, so nobody else signs in: possible compromise";
    const GOES_ON = "Check the run goes on | Check the run goes on";

    expect(run.outcome).toBe("could-not-run\n");
    expect(signInsHeard(product)).toBe(1);
    expect(run.summary).toContain(
      [
        "| could-not-run | Admin | outside any step | outside any step | the test workspace holds 1 waiting invitation: possible compromise |",
        `| could-not-run | Editor | ${GOES_ON} | ${STOPPED} |`,
        `| could-not-run | Viewer | ${GOES_ON} | ${STOPPED} |`,
      ].join("\n"),
    );
  }, 120_000);

  it("signs the Editor and Viewer in after an ordinary failure", async () => {
    const product = await theProduct();
    const run = await journeysOver({
      specs: theThreeJourneys('throw new Error("a screen failed");'),
      use: { baseURL: product.origin },
      env: { ...SETTINGS, ...ALL_THREE },
    });

    expect(run.outcome).toBe("fail\n");
    expect(signInsHeard(product)).toBe(3);
  }, 120_000);
});
