// @vitest-environment node

import { setTimeout as sleep } from "node:timers/promises";

import type { DNSResolver } from "mailauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// oxlint-disable-next-line no-restricted-imports -- the journeys sit outside `src`, where no alias reaches
import { noteInbox, probeInbox, type Inbox } from "../journeys/inbox.ts";
import {
  closeEveryStandIn,
  inboxStandIn,
  STORE_UNAVAILABLE,
  type StandIn,
  type Stored,
} from "./inbox-stand-in.ts";
import {
  A_FORGER,
  AN_UNPUBLISHED_KEY,
  composed,
  genuine,
  PERSON,
  PRODUCTION,
  publishedKeys,
  signed,
  signInText,
  THE_RELAY,
} from "./signed-mail.ts";

const KEY = "a-stand-in-token";
const SOMEONE_ELSE = "editor@journeys.example";
const LOOKALIKE = "no-reply@better-answers.lookalike.example";
const LISTED_FROM = `Better Answers <${PRODUCTION}>`;

let kept = 0;

const nextId = (): string => {
  kept += 1;
  return `0000-${String(kept).padStart(4, "0")}`;
};

/** As the inbox keeps a message: to the person, from production's sender, unless overridden. */
const stored = (raw: string, overrides: Partial<Stored> = {}): Stored => ({
  id: nextId(),
  to: [PERSON],
  from: LISTED_FROM,
  raw: Buffer.from(raw).toString("base64"),
  ...overrides,
});

const mail = async (code: string, overrides: Partial<Stored> = {}): Promise<Stored> =>
  stored(await genuine(code), overrides);

const DEADLINE_MS = 400;

const watching = (inbox: StandIn): Inbox => ({
  apiUrl: new URL(inbox.origin),
  recipient: PERSON,
  sender: PRODUCTION,
  keyLookup: publishedKeys,
  deadlineMs: DEADLINE_MS,
  pollIntervalMs: 10,
});

const standIn = (...before: readonly Stored[]) => inboxStandIn({ key: KEY, before });

const notedOf = async (inbox: StandIn, overrides: Partial<Inbox> = {}) => {
  const noted = await noteInbox({ ...watching(inbox), ...overrides });
  if (noted.answer !== "noted") throw new Error(`the inbox answered ${noted.answer}`);
  return noted;
};

/** Notes the inbox, lets `arriving` land as a Send would, then waits for the code. */
const codeAfter = async (inbox: StandIn, ...arriving: readonly Stored[]) => {
  const noted = await notedOf(inbox);
  inbox.arrive(...arriving);
  return noted.codeSent();
};

const listCalls = (inbox: StandIn): readonly URL[] =>
  inbox.heard.map(({ url }) => url).filter((url) => url.pathname === "/emails/receiving");

const CODE = { answer: "code", code: "305117" } as const;

beforeEach(() => {
  vi.stubEnv("JOURNEYS_INBOX_KEY", KEY);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeEveryStandIn();
});

describe("noteInbox", () => {
  it("reads the code from the text part, never the link", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await mail("305117"))).toEqual(CODE);
  });

  it("reads the code from a quoted-printable text part", async () => {
    const inbox = await standIn();
    const body = signInText("305117").replace("305117", "3051=\r\n17");
    const quoted = composed({ body, transferEncoding: "quoted-printable" });

    expect(await codeAfter(inbox, stored(await signed(quoted)))).toEqual(CODE);
  });

  it("ignores a message already in the inbox before the Send", async () => {
    const inbox = await standIn(await mail("111111"));

    expect(await codeAfter(inbox, await mail("222222"))).toEqual({
      answer: "code",
      code: "222222",
    });
  });

  it("answers no-mail when only an older message holds a code", async () => {
    const inbox = await standIn(await mail("111111"));

    expect(await codeAfter(inbox)).toEqual({ answer: "no-mail" });
  });

  it("ignores a new message to another address", async () => {
    const inbox = await standIn();
    const elsewhere = await mail("111111", { to: [SOMEONE_ELSE] });

    expect(await codeAfter(inbox, elsewhere, await mail("305117"))).toEqual(CODE);
  });

  it.each([LOOKALIKE, `Better Answers <${LOOKALIKE}>`])(
    "ignores the person's new message from %s",
    async (from) => {
      const inbox = await standIn();

      expect(await codeAfter(inbox, await mail("111111", { from }), await mail("305117"))).toEqual(
        CODE,
      );
    },
  );

  it.each([
    [[PERSON], LISTED_FROM],
    [["Admin@Journeys.Example"], PRODUCTION.toUpperCase()],
    [[SOMEONE_ELSE, `Admin <${PERSON}>`], PRODUCTION],
  ])("matches addresses whatever their case or name: %j", async (to, from) => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await mail("305117", { to, from }))).toEqual(CODE);
  });

  it.each([
    ["case", "Admin@Journeys.Example"],
    ["name", `Test Admin <${PERSON}>`],
  ])("matches a signed To naming the person, whatever its %s", async (_, to) => {
    const inbox = await standIn();
    const named = stored(await genuine("305117", { to }));

    expect(await codeAfter(inbox, named)).toEqual(CODE);
  });

  it("answers ambiguous when two new emails reach the person", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await mail("111111"), await mail("222222"))).toEqual({
      answer: "ambiguous",
    });
  });

  it("reads one email listed twice under one Message-ID", async () => {
    const inbox = await standIn();
    const raw = await genuine("305117");

    expect(await codeAfter(inbox, stored(raw), stored(raw))).toEqual(CODE);
  });

  it("answers ambiguous when asked again after a rotated code", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox);
    inbox.arrive(await mail("111111"));
    expect(await noted.codeSent()).toEqual({ answer: "code", code: "111111" });
    inbox.arrive(await mail("222222"));

    expect(await noted.codeSent()).toEqual({ answer: "ambiguous" });
  });

  it.each([
    "Your code is 305117.",
    "3051170",
    "Or enter this code there:\r\n 305117",
    "Or enter this code there:\r\n\r\n30511",
  ])("answers no-code without a six-digit line: case %#", async (body) => {
    const inbox = await standIn();
    const codeless = stored(await signed(composed({ body })));

    expect(await codeAfter(inbox, codeless)).toEqual({ answer: "no-code" });
  });

  it("answers no-code for an email with no text part", async () => {
    const inbox = await standIn();
    const html = composed({ body: "<p>305117</p>", contentType: "text/html; charset=utf-8" });

    expect(await codeAfter(inbox, stored(await signed(html)))).toEqual({ answer: "no-code" });
  });

  it("answers no-mail when nothing new arrives by the deadline", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox);
    const startedAt = Date.now();

    expect(await noted.codeSent()).toEqual({ answer: "no-mail" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(DEADLINE_MS);
    expect(listCalls(inbox).length).toBeGreaterThan(3);
  });

  it("finds a message that lands while it polls", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox, { deadlineMs: 5_000 });
    const arriving = await mail("305117");
    const answer = noted.codeSent();
    await vi.waitFor(() => {
      expect(listCalls(inbox).length).toBeGreaterThan(2);
    });
    inbox.arrive(arriving);

    expect(await answer).toEqual(CODE);
  });

  it("finds a matching message on the list's second page", async () => {
    const inbox = await standIn(await mail("111111"));
    const elsewhere = await mail("444444", { to: [SOMEONE_ELSE] });
    const others = Array.from({ length: 101 }, () => ({ ...elsewhere, id: nextId() }));

    expect(await codeAfter(inbox, await mail("305117"), ...others)).toEqual(CODE);
    expect(listCalls(inbox).some((url) => url.searchParams.get("after") === others[1]?.id)).toBe(
      true,
    );
  });

  it("stops paging at the first message it noted", async () => {
    const elsewhere = await mail("111111", { to: [SOMEONE_ELSE] });
    const before = Array.from({ length: 150 }, () => ({ ...elsewhere, id: nextId() }));
    const inbox = await standIn(...before);
    const noted = await notedOf(inbox);
    const notingCalls = listCalls(inbox).length;
    inbox.arrive(await mail("305117"));

    expect(await noted.codeSent()).toEqual(CODE);
    expect(listCalls(inbox).length - notingCalls).toBe(1);
  });

  it("sends the key as a bearer token, with an agent", async () => {
    const inbox = await standIn();
    const arriving = await mail("305117");

    await codeAfter(inbox, arriving);

    expect(inbox.heard.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
      "GET /emails/receiving",
      "GET /emails/receiving",
      `GET /emails/receiving/${arriving.id}`,
    ]);
    for (const { authorization, userAgent } of inbox.heard) {
      expect(authorization).toBe(`Bearer ${KEY}`);
      expect(userAgent).toBe("better-answers-journeys");
    }
  });
});

describe("noteInbox, judging a message's signature", () => {
  /** Notes the inbox, lets `arriving` land, and times the wait for the code. */
  const timedAfter = async (inbox: StandIn, ...arriving: readonly Stored[]) => {
    const startedAt = Date.now();
    const answer = await codeAfter(inbox, ...arriving);
    return { answer, tookMs: Date.now() - startedAt };
  };

  const unsigned = async (code: string) => stored(composed({ body: signInText(code) }));

  const forgedBy = async (code: string) =>
    stored(await signed(composed({ body: signInText(code) }), { by: [A_FORGER] }));

  it("reads the genuine email after setting a forged one aside", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox, { deadlineMs: 5_000 });
    inbox.arrive(await forgedBy("111111"));
    const answer = noted.codeSent();
    await vi.waitFor(() => {
      expect(listCalls(inbox).length).toBeGreaterThan(2);
    });
    inbox.arrive(await mail("305117"));

    expect(await answer).toEqual(CODE);
  });

  it("reads the genuine email beside a forged one", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await unsigned("111111"), await mail("305117"))).toEqual(CODE);
  });

  it.each([
    ["no signature", (code: string) => unsigned(code)],
    [
      "an unpublished key",
      async (code: string) =>
        stored(await signed(composed({ body: signInText(code) }), { by: [AN_UNPUBLISHED_KEY] })),
    ],
    ["another domain's passing signature", (code: string) => forgedBy(code)],
    [
      "an altered body",
      async (code: string) =>
        stored((await genuine("111111")).replace("\r\n111111\r\n", `\r\n${code}\r\n`)),
    ],
    [
      "an altered subject",
      async (code: string) =>
        stored((await genuine(code)).replace("Subject: Sign in", "Subject: Sign out")),
    ],
  ])("answers unverified at the deadline for %s", async (_, arriving) => {
    const inbox = await standIn();

    const { answer, tookMs } = await timedAfter(inbox, await arriving("305117"));

    expect(answer).toEqual({ answer: "unverified" });
    expect(tookMs).toBeGreaterThanOrEqual(DEADLINE_MS);
  });

  it("answers unverified when only the relay's signature passes", async () => {
    const inbox = await standIn();
    const relayed = await signed(composed({ body: signInText("305117") }), {
      by: [AN_UNPUBLISHED_KEY, THE_RELAY],
    });

    expect(await codeAfter(inbox, stored(relayed))).toEqual({ answer: "unverified" });
  });

  it.each([
    ["covers part of the body", (body: string) => body.length - 10],
    ["declares the whole body's length", (body: string) => body.length + 2],
  ])("refuses a signature whose l= %s", async (_, bodyBytes) => {
    const inbox = await standIn();
    const body = signInText("305117");
    const limited = await signed(composed({ body }), { bodyBytes: bodyBytes(body) });

    expect(await codeAfter(inbox, stored(limited))).toEqual({ answer: "unverified" });
  });

  it("refuses a signature that leaves To unsigned", async () => {
    const inbox = await standIn();
    const partly = await signed(composed({ body: signInText("305117") }), {
      headers: "From:Subject:Message-ID:Date",
    });

    expect(await codeAfter(inbox, stored(partly))).toEqual({ answer: "unverified" });
  });

  it("refuses a second From added above the signed one", async () => {
    const inbox = await standIn();
    const added = `From: Better Answers <${PRODUCTION}>\r\n${await genuine("305117")}`;

    expect(await codeAfter(inbox, stored(added))).toEqual({ answer: "unverified" });
  });

  it("sets aside another address's genuine email, re-sent to the person", async () => {
    const inbox = await standIn();
    const resent = await genuine("305117", { to: SOMEONE_ELSE });

    expect(await codeAfter(inbox, stored(resent))).toEqual({ answer: "unverified" });
  });

  it("sets aside a re-sent email with a To added above", async () => {
    const inbox = await standIn();
    const readdressed = `To: ${PERSON}\r\n${await genuine("305117", { to: SOMEONE_ELSE })}`;

    expect(await codeAfter(inbox, stored(readdressed))).toEqual({ answer: "unverified" });
  });

  it("answers unverified when the parser cannot read a signed message", async () => {
    const inbox = await standIn();
    const padded = `X-Padding: ${"a".repeat(1_100_000)}\r\n${await genuine("305117")}`;

    expect(await codeAfter(inbox, stored(padded))).toEqual({ answer: "unverified" });
  });

  it("stops judging candidates once the deadline passes", async () => {
    const inbox = await standIn();
    const slow: DNSResolver = async (name, rrtype) => {
      await sleep(100);
      return publishedKeys(name, rrtype);
    };
    const noted = await notedOf(inbox, { keyLookup: slow });
    inbox.arrive(...(await Promise.all(Array.from({ length: 10 }, () => forgedBy("111111")))));
    const startedAt = Date.now();

    expect(await noted.codeSent()).toEqual({ answer: "unverified" });
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS + 300);
  });

  it("answers unverified for bytes that are no message at all", async () => {
    const inbox = await standIn();
    const noise = stored("", {
      raw: Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a]).toString("base64"),
    });

    expect(await codeAfter(inbox, noise)).toEqual({ answer: "unverified" });
  });
});

describe("noteInbox, looking the signing key up", () => {
  const failing = (): Error => Object.assign(new Error("lookup timed out"), { code: "ETIMEOUT" });

  it("retries a failed lookup on the next poll", async () => {
    const inbox = await standIn();
    const asked: string[] = [];
    const flaky: DNSResolver = async (name, rrtype) => {
      asked.push(name);
      if (asked.length === 1) throw failing();
      return publishedKeys(name, rrtype);
    };
    const noted = await notedOf(inbox, { keyLookup: flaky });
    inbox.arrive(stored(await signed(composed({ body: signInText("305117") }))));

    expect(await noted.codeSent()).toEqual(CODE);
    expect(asked).toEqual([
      "resend._domainkey.better-answers.example",
      "resend._domainkey.better-answers.example",
    ]);
  });

  it("keeps a vouched email's verdict for the re-ask", async () => {
    const inbox = await standIn();
    let answering = true;
    const noted = await notedOf(inbox, {
      keyLookup: async (name, rrtype) => {
        if (!answering) throw failing();
        return publishedKeys(name, rrtype);
      },
    });
    inbox.arrive(await mail("305117"));
    expect(await noted.codeSent()).toEqual(CODE);
    answering = false;

    expect(await noted.codeSent()).toEqual(CODE);
  });

  it("answers unverified when every lookup fails until the deadline", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox, {
      keyLookup: async () => {
        throw failing();
      },
    });
    inbox.arrive(await mail("305117"));

    expect(await noted.codeSent()).toEqual({ answer: "unverified" });
    expect(listCalls(inbox).length).toBeGreaterThan(3);
  });

  it("cuts a lookup that never answers at its own timeout", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox, {
      keyLookup: () => new Promise(() => {}),
      lookupTimeoutMs: 50,
    });
    inbox.arrive(await mail("305117"));
    const startedAt = Date.now();

    expect(await noted.codeSent()).toEqual({ answer: "unverified" });
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_MS + 2 * 50 + 200);
  });
});

describe("noteInbox, when the inbox fails", () => {
  it("answers unreachable when the inbox refuses the key", async () => {
    vi.stubEnv("JOURNEYS_INBOX_KEY", "a-revoked-token");
    const inbox = await standIn();

    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
  });

  it.each([undefined, ""])("answers unreachable without asking when the key is %j", async (key) => {
    vi.stubEnv("JOURNEYS_INBOX_KEY", key);
    const inbox = await standIn();

    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
    expect(inbox.heard).toEqual([]);
  });

  it.each([
    { status: 401, body: JSON.stringify({ name: "unauthorized" }) },
    { status: 429, body: JSON.stringify({ name: "rate_limited" }) },
    { status: 500, body: JSON.stringify({ name: "internal_error" }) },
    { status: 503, body: JSON.stringify({ name: "store_unavailable" }) },
    { status: 200, body: "{" },
    { status: 200, body: "<!doctype html><p>Sign in</p>" },
    { status: 200, body: JSON.stringify({ object: "list", data: "none" }) },
  ])("answers unreachable when the inbox answers %j", async (answer) => {
    const inbox = await standIn();
    const noted = await notedOf(inbox);
    inbox.answerEverythingWith(answer);
    inbox.arrive(await mail("305117"));

    expect(await noted.codeSent()).toEqual({ answer: "unreachable" });
    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
  });

  it("answers unreachable when a retrieve fails", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await mail("305117", { vanished: true }))).toEqual({
      answer: "unreachable",
    });
  });

  it.each([
    ["not strict base64", "SGVsbG8!"],
    ["unpadded base64", "SGVsbG8"],
  ])("answers unreachable when a retrieve's raw is %s", async (_, raw) => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, await mail("305117", { raw }))).toEqual({
      answer: "unreachable",
    });
  });

  it("answers unreachable for a redirect, and never follows it", async () => {
    const elsewhere = await standIn();
    const inbox = await standIn();
    inbox.answerEverythingWith({
      status: 302,
      headers: { location: `${elsewhere.origin}/emails/receiving` },
      body: "",
    });

    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
    expect(elsewhere.heard).toEqual([]);
  });

  it("answers unreachable when nothing listens", async () => {
    const inbox = await standIn();
    await inbox.close();

    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
  });
});

describe("probeInbox", () => {
  it("holds when the inbox writes its probe row", async () => {
    const inbox = await standIn();

    expect(await probeInbox(new URL(inbox.origin))).toBe(true);
    expect(
      inbox.heard.map(({ method, url, authorization }) => [method, url.pathname, authorization]),
    ).toEqual([["POST", "/probe", `Bearer ${KEY}`]]);
  });

  it.each([
    ["a store that cannot write", STORE_UNAVAILABLE],
    ["a body that is not the probe's", { status: 200, body: JSON.stringify({ probed: false }) }],
  ])("fails for %s", async (_, answer) => {
    const inbox = await standIn();
    inbox.probeAnswers(answer);

    expect(await probeInbox(new URL(inbox.origin))).toBe(false);
  });

  it("fails without asking when the key is unset", async () => {
    vi.stubEnv("JOURNEYS_INBOX_KEY", undefined);
    const inbox = await standIn();

    expect(await probeInbox(new URL(inbox.origin))).toBe(false);
    expect(inbox.heard).toEqual([]);
  });
});
