// @vitest-environment node

import { rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { INVENTED_MEMBERS, inventedMemberAddress } from "@better-answers/schema/test-workspace";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { CONFIRM_WORDS } from "@/features/auth/second-factor-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";

import {
  closeEveryStandIn,
  inboxStandIn,
  loopbackTls,
  STORE_UNAVAILABLE,
  type Tls,
} from "./inbox-stand-in.ts";
import { journeysOver, moduleAt } from "./playwright-tree.ts";

const ADMIN = "admin@journeys.example";
const EDITOR = "editor@journeys.example";
const CODE = "305117";
const SESSION = "session=a-journeys-session";

/** The test Admin's authenticator key, as the harness answers it. */
const KEY = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Six digits submit on their own, as the product's screen does, and then six more confirm. */
const SCREEN = [
  '<!doctype html><html lang="en"><title>Sign in</title><main>',
  `<label>${SIGN_IN_WORDS.emailField} <input type="email"></label>`,
  `<button id="send">${SIGN_IN_WORDS.send}</button>`,
  `<label id="step" hidden>${SIGN_IN_WORDS.codeField} <input id="code"></label>`,
  `<label id="confirm" hidden>${CONFIRM_WORDS.codeField} <input id="factor"></label>`,
  "<script>",
  'document.getElementById("send").onclick = async () => {',
  '  const sent = await fetch("/email-otp/send-verification-otp", { method: "POST" });',
  '  if (sent.ok) document.getElementById("step").hidden = false;',
  "};",
  'document.getElementById("code").oninput = async ({ target }) => {',
  "  if (target.value.length !== 6) return;",
  '  const signedIn = await fetch("/sign-in/email-otp", { method: "POST", body: target.value });',
  '  if (signedIn.ok) document.getElementById("step").remove();',
  '  if (signedIn.ok) document.getElementById("confirm").hidden = false;',
  "};",
  'document.getElementById("factor").oninput = async ({ target }) => {',
  "  if (target.value.length !== 6) return;",
  '  const confirmed = await fetch("/second-factor/confirm/authenticator", { method: "POST", body: target.value });',
  '  if (confirmed.ok) document.getElementById("confirm").remove();',
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

type Replies = {
  readonly send?: Reply;
  /** The confirm's answer, in place of judging the code against the key. */
  readonly confirm?: Reply;
  readonly signOuts?: readonly Reply[];
  /** By request, such as `GET /trpc/members.list`, answered whoever asks. */
  readonly reads?: ReadonlyMap<string, Reply>;
};

const OK: Reply = { status: 200, body: "{}" };

/** A sign-in opens at `/`, which the product's SPA takes to its sign-in screen. */
const SHOWING_THE_SCREEN = new Set(["GET /", "GET /sign-in"]);

const THE_SCREEN: Reply = { status: 200, headers: { "content-type": "text/html" }, body: SCREEN };

const readReplyTo = (asked: string, replies: Replies): Reply | undefined =>
  SHOWING_THE_SCREEN.has(asked) ? THE_SCREEN : replies.reads?.get(asked);

/** The harness's authenticator for the test Admin, and the confirm page's post. */
const factorReplyTo = (asked: string, body: string, replies: Replies): Reply | undefined => {
  if (asked === "POST /__harness/authenticators") {
    return { status: 200, body: JSON.stringify({ key: KEY, recoveryCodes: [] }) };
  }
  if (asked === "POST /second-factor/confirm/authenticator")
    return replies.confirm ?? confirmed(body);
  return undefined;
};

const replyTo = (asked: string, body: string, replies: Replies, signOut: () => Reply): Reply => {
  const factor = factorReplyTo(asked, body, replies);
  if (factor !== undefined) return factor;
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

const STEP_MS = 30_000;

/** The code the key shows now, or the step either side, so a step's edge never flakes. */
const confirmed = (body: string): Reply => {
  const now = Date.now();
  const shown = [now - STEP_MS, now, now + STEP_MS].map((at) =>
    authenticatorCodeAt(KEY, new Date(at)),
  );
  return shown.includes(body) ? OK : { status: 400, body: '{"error":"code-wrong"}' };
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
      const reply =
        readReplyTo(asked, replies) ?? replyTo(asked, body, replies, () => signOuts.shift() ?? OK);
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
  await closeEveryStandIn();
});

/** Every setting a journey reads, as the journeys' step holds them, unset where left empty. */
const SETTINGS = {
  JOURNEYS_CODE_SOURCE: "harness",
  JOURNEYS_ADMIN_EMAIL: ADMIN,
  JOURNEYS_EDITOR_EMAIL: EDITOR,
  JOURNEYS_VIEWER_EMAIL: "",
  JOURNEYS_SENDER: "",
  JOURNEYS_INBOX_URL: "",
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
  "POST /__harness/authenticators",
  "GET /",
  "POST /email-otp/send-verification-otp",
  "GET /__harness/codes",
  "POST /sign-in/email-otp",
  "POST /second-factor/confirm/authenticator",
  "POST /sign-out",
];

describe("a journey that names its role", () => {
  let product: Product;
  let run: Awaited<ReturnType<typeof journeysOver>>;

  beforeAll(async () => {
    product = await theProduct();
    run = await journeysAgainst(product, journeyOf(...AS_THE_ADMIN));
  }, 120_000);

  it("signs its person in, confirms, then out on the server", () => {
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

  it.each([
    "http://inbox.journeys.example",
    "https://inbox.journeys.example/emails",
    "https://reader:hunter2@inbox.journeys.example",
    "https://inbox.journeys.example/?token=hunter2",
    "inbox.journeys.example",
  ])(
    "names a malformed inbox URL, never its value: %s",
    async (url) => {
      const product = await theProduct();
      const run = await journeysAgainst(product, journeyOf(...AS_THE_EDITOR), {
        JOURNEYS_CODE_SOURCE: "inbox",
        JOURNEYS_SENDER: SENDER,
        JOURNEYS_INBOX_URL: url,
      });

      expect(run.outcome).toBe("could-not-run\n");
      expect(run.summary).toContain(`| ${SETTINGS_STEP} | ${NO_INBOX_URL} |\n`);
      expect(`${run.summary}${run.stdout}${run.stderr}`).not.toContain("inbox.journeys.example");
    },
    120_000,
  );

  it("names an unset inbox URL", async () => {
    const product = await theProduct();
    const run = await journeysAgainst(product, journeyOf(...AS_THE_EDITOR), {
      JOURNEYS_CODE_SOURCE: "inbox",
      JOURNEYS_SENDER: SENDER,
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(`| ${SETTINGS_STEP} | ${NO_INBOX_URL} |\n`);
    expect(product.heard.map(({ asked }) => asked)).toEqual(["POST /sign-out"]);
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

const CONFIRM_STEP = "Confirm the second factor | Confirm the second factor";

describe("the Admin's second factor", () => {
  it("names a missing authenticator key, never its value", async () => {
    const product = await theProduct();
    const run = await journeysAgainst(product, journeyOf(...AS_THE_ADMIN), {
      JOURNEYS_CODE_SOURCE: "inbox",
      JOURNEYS_SENDER: "Better Answers <no-reply@better-answers.example>",
      JOURNEYS_INBOX_URL: "https://inbox.journeys.example/",
      JOURNEYS_ADMIN_AUTHENTICATOR_KEY: "not-a-key!",
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      "| could-not-run | Admin | Read the journeys' settings | Read the journeys' settings | JOURNEYS_ADMIN_AUTHENTICATOR_KEY is not set to an authenticator's key |\n",
    );
    expect(`${run.summary}${run.stdout}${run.stderr}`).not.toContain("not-a-key!");
    expect(product.heard.map(({ asked }) => asked)).toEqual(["POST /sign-out"]);
  }, 120_000);

  it("tells a refused confirm from one the ground stopped", async () => {
    const runs = await Promise.all(
      [
        { status: 400, body: '{"error":"code-wrong"}' },
        { status: 429, body: "{}" },
        { status: 409, body: '{"error":"no-authenticator"}' },
      ].map(async (confirm) =>
        journeysAgainst(await theProduct({ confirm }), journeyOf(...AS_THE_ADMIN)),
      ),
    );

    expect(runs.map((run) => run.outcome)).toEqual([
      "fail\n",
      "could-not-run\n",
      "could-not-run\n",
    ]);
    expect(runs.map((run) => run.summary)).toEqual([
      expect.stringContaining(
        `| fail | Admin | ${CONFIRM_STEP} | the product refused the code the test Admin's authenticator key makes, answering 400 |`,
      ),
      expect.stringContaining(
        `| could-not-run | Admin | ${CONFIRM_STEP} | a rate ceiling refused the confirm |`,
      ),
      expect.stringContaining(
        `| could-not-run | Admin | ${CONFIRM_STEP} | the test Admin holds no authenticator to confirm |`,
      ),
    ]);
  }, 180_000);
});

const VIEWER = "viewer@journeys.example";

const SENDER = "Better Answers <no-reply@better-answers.example>";
const SETTINGS_STEP = "Read the journeys' settings | Read the journeys' settings";
const NO_INBOX_URL = "JOURNEYS_INBOX_URL is not set to a bare https origin";

const ALL_THREE = { ...SETTINGS, JOURNEYS_VIEWER_EMAIL: VIEWER };

/** The Editor's and Viewer's journeys, which sign in and pass through. */
const THE_OTHER_TWO = {
  "editor.spec.ts": journeyOf(...AS_THE_EDITOR),
  "viewer.spec.ts": journeyOf(
    'test.use({ role: "Viewer" });',
    'test("the Viewer passes through the screen", async () => {});',
  ),
};

/** The three journeys under their own names, the Admin's ending as `adminEnds` says. */
const theThreeJourneys = (adminEnds: string) => ({
  "admin.spec.ts": journeyOf(
    `import { stopTheRun } from ${moduleAt("journeys/run-stop.ts")};`,
    'test.use({ role: "Admin" });',
    `test("the Admin's journey ends early", async () => { ${adminEnds} });`,
  ),
  ...THE_OTHER_TWO,
});

const signInsHeard = (product: Product): number =>
  product.heard.filter(({ asked }) => asked === "POST /sign-in/email-otp").length;

describe("a run the Admin's journey stops", () => {
  it("signs the Editor and Viewer in nowhere, once stopped", async () => {
    const product = await theProduct();
    const run = await journeysOver({
      specs: theThreeJourneys('stopTheRun("the test workspace holds 1 waiting invitation");'),
      use: { baseURL: product.origin },
      env: ALL_THREE,
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
      env: ALL_THREE,
    });

    expect(run.outcome).toBe("fail\n");
    expect(signInsHeard(product)).toBe(3);
  }, 120_000);
});

/** The Admin's journey as far as its check, with the other two after it. */
const THE_CHECK = {
  "admin.spec.ts": [
    `import { test, theTestPeople } from ${moduleAt("journeys/fixtures.ts")};`,
    `import { theFixtureHolds } from ${moduleAt("journeys/test-workspace.ts")};`,
    'test.use({ role: "Admin" });',
    'test("the Admin checks the test workspace", async ({ page }) => {',
    "  await theFixtureHolds(page, theTestPeople());",
    "});",
    "",
  ].join("\n"),
  ...THE_OTHER_TWO,
};

const answered = (data: unknown): Reply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ result: { data } }),
});

const SOUND_MEMBERS = [
  { displayName: "Test Admin", address: ADMIN, role: "Admin" },
  { displayName: "Test Editor", address: EDITOR, role: "Editor" },
  { displayName: "Test Viewer", address: VIEWER, role: "Viewer" },
  ...Array.from({ length: INVENTED_MEMBERS }, (_, index) => ({
    displayName: `Invented member ${String(index + 1)}`,
    address: inventedMemberAddress(index + 1, "journeys.example"),
    role: "Viewer",
  })),
];

/** The test workspace's reads as the fixture command leaves it, less what `changed` answers. */
const aWorkspace = (changed: Readonly<Record<string, Reply>> = {}): ReadonlyMap<string, Reply> =>
  new Map(
    Object.entries({
      "GET /trpc/session.membership": answered({
        workspace: { name: "Test workspace" },
        person: { name: "Test Admin" },
        role: "Admin",
      }),
      "GET /trpc/members.list": answered(SOUND_MEMBERS),
      "GET /trpc/members.invitationCounts": answered({ waiting: 0, accepted: 0, expired: 0 }),
      "GET /trpc/sources.list": answered([]),
      ...changed,
    }),
  );

const checkedAgainst = async (reads: ReadonlyMap<string, Reply>) => {
  const product = await theProduct({ reads });
  const run = await journeysOver({
    specs: THE_CHECK,
    use: { baseURL: product.origin },
    env: ALL_THREE,
  });
  return { ...run, signIns: signInsHeard(product) };
};

const stoppedFor = (why: string): string =>
  `| could-not-run | Admin | outside any step | outside any step | ${why}: possible compromise |`;

describe("the Admin's check of the test workspace, through its reads", () => {
  it("lets the run go on over the fixture as made", async () => {
    const run = await checkedAgainst(aWorkspace());

    expect(run.outcome).toBe("held\n");
    expect(run.signIns).toBe(3);
  }, 120_000);

  it("stops the run for a member outside the fixture", async () => {
    const stranger = {
      displayName: "A stranger",
      address: "stranger@elsewhere.example",
      role: "Viewer",
    };
    const run = await checkedAgainst(
      aWorkspace({ "GET /trpc/members.list": answered([...SOUND_MEMBERS, stranger]) }),
    );

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(
      stoppedFor("the test workspace's check found 1 member outside its fixture"),
    );
    expect(`${run.summary}${run.stdout}`).not.toContain("@");
  }, 120_000);

  it("stops the run for a waiting invitation", async () => {
    const run = await checkedAgainst(
      aWorkspace({ "GET /trpc/members.invitationCounts": answered({ waiting: 1 }) }),
    );

    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(
      stoppedFor("the test workspace's check found 1 waiting invitation"),
    );
  }, 120_000);

  it("stops the run for a binding", async () => {
    const run = await checkedAgainst(
      aWorkspace({ "GET /trpc/sources.list": answered([{ id: "a-binding" }]) }),
    );

    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(stoppedFor("the test workspace's check found 1 binding"));
  }, 120_000);

  it("stops the run for a missing invented member", async () => {
    const gone = inventedMemberAddress(30, "journeys.example");
    const members = SOUND_MEMBERS.filter((member) => member.address !== gone);
    const run = await checkedAgainst(aWorkspace({ "GET /trpc/members.list": answered(members) }));

    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(
      stoppedFor("the test workspace's check found 1 member of its fixture missing"),
    );
  }, 120_000);
});

/** As the api answers a refused act: its word as the message, and the word again in `data`. */
const refusedWith = (word: string, status: number): Reply => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    error: {
      message: word,
      code: -32_003,
      data: { code: "FORBIDDEN", httpStatus: status, refusal: { word, class: "forbidden" } },
    },
  }),
});

describe("the Admin's check, when the Admin's own standing changed", () => {
  it("stops the run when the test Admin reads as Viewer", async () => {
    const asAViewer = answered({
      workspace: { name: "Test workspace" },
      person: { name: "Test Admin" },
      role: "Viewer",
    });
    const run = await checkedAgainst(aWorkspace({ "GET /trpc/session.membership": asAViewer }));

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(stoppedFor("the test Admin no longer holds the Admin role"));
  }, 120_000);

  it("stops the run when the Admin's members read is refused", async () => {
    const run = await checkedAgainst(
      aWorkspace({ "GET /trpc/members.list": refusedWith("role-forbids", 403) }),
    );

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(
      stoppedFor("the test workspace refused the Admin's read of members.list (role-forbids)"),
    );
  }, 120_000);

  it("stops the run when the product refuses the Admin's membership", async () => {
    const run = await checkedAgainst(
      aWorkspace({ "GET /trpc/session.membership": refusedWith("not-a-member", 401) }),
    );

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.signIns).toBe(1);
    expect(run.summary).toContain(
      stoppedFor(
        "the test workspace refused the Admin's read of session.membership (not-a-member)",
      ),
    );
  }, 120_000);

  it("fails at an edge's 403 naming no word, as before", async () => {
    const edge: Reply = {
      status: 403,
      headers: { "content-type": "text/html" },
      body: "<h1>403</h1>",
    };
    const run = await checkedAgainst(aWorkspace({ "GET /trpc/members.list": edge }));

    expect(run.outcome).toBe("fail\n");
    expect(run.signIns).toBe(3);
  }, 120_000);

  it("fails at a 500 read, and the others still run", async () => {
    const failed: Reply = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { message: "listMembers failed", code: -32_603 } }),
    };
    const run = await checkedAgainst(aWorkspace({ "GET /trpc/members.list": failed }));

    expect(run.outcome).toBe("fail\n");
    expect(run.signIns).toBe(3);
  }, 120_000);
});

const INBOX_KEY = "a-stand-in-token";

/** The preflight's last two steps: the sign-in screen, then the settings and the test inbox. */
const PREFLIGHT = [
  `import { test, theSettingsAndInboxHold } from ${moduleAt("journeys/fixtures.ts")};`,
  'test("the preflight checks the settings", async ({ page, request }) => {',
  '  await page.goto("/sign-in");',
  "  await theSettingsAndInboxHold(request);",
  "});",
  "",
].join("\n");

describe("the preflight, against the test inbox", () => {
  let tls: Tls;

  beforeAll(() => {
    tls = loopbackTls();
  });

  afterAll(() => {
    rmSync(path.dirname(tls.certFile), { recursive: true, force: true });
  });

  let product: Product;

  beforeEach(async () => {
    product = await theProduct();
  });

  const preflightAgainst = async (inbox: { readonly origin: string }) =>
    journeysOver({
      spec: PREFLIGHT,
      use: { baseURL: product.origin },
      env: {
        ...ALL_THREE,
        JOURNEYS_CODE_SOURCE: "inbox",
        JOURNEYS_SENDER: SENDER,
        JOURNEYS_INBOX_URL: inbox.origin,
        JOURNEYS_INBOX_KEY: INBOX_KEY,
        NODE_EXTRA_CA_CERTS: tls.certFile,
      },
    });

  it("lists then probes the inbox at the set URL", async () => {
    const inbox = await inboxStandIn({ key: INBOX_KEY, tls });
    const run = await preflightAgainst(inbox);

    expect(run.status).toBe(0);
    expect(
      inbox.heard.map(({ method, url, authorization }) => [method, url.pathname, authorization]),
    ).toEqual([
      ["GET", "/emails/receiving", `Bearer ${INBOX_KEY}`],
      ["POST", "/probe", `Bearer ${INBOX_KEY}`],
    ]);
  }, 120_000);

  it("could not run when the inbox cannot store mail", async () => {
    const inbox = await inboxStandIn({ key: INBOX_KEY, tls });
    inbox.probeAnswers(STORE_UNAVAILABLE);
    const run = await preflightAgainst(inbox);
    const STEP = "Read the journeys' settings and note the test inbox";

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      `| could-not-run |  | ${STEP} | ${STEP} | the test inbox could not store a message |\n`,
    );
    expect(product.heard.map(({ asked }) => asked)).toEqual(["GET /sign-in"]);
  }, 120_000);
});
