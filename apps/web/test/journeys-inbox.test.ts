// @vitest-environment node

import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// oxlint-disable-next-line no-restricted-imports -- the journeys sit outside `src`, where no alias reaches
import { noteInbox, type Inbox } from "../journeys/inbox.ts";

const KEY = "re_stand_in_key";
const PERSON = "admin@journeys.example";
const SOMEONE_ELSE = "editor@journeys.example";
const PRODUCTION = "sign-in@mail.better-answers.example";
const LOOKALIKE = "sign-in@better-answers.lookalike.example";

type Authentication = { readonly spf: string; readonly dkim: string; readonly dmarc: string };

const ALIGNED: Authentication = { spf: "pass", dkim: "pass", dmarc: "pass" };

type Mail = {
  readonly id: string;
  readonly to: readonly string[];
  readonly from: string;
  readonly text: string | null;
  readonly html: string;
  /** Undefined leaves the field out of the retrieve's body altogether. */
  readonly authentication?: Authentication | null | undefined;
  /** Listed, but gone by the time it is retrieved, as an expired message is. */
  readonly vanished?: boolean;
};

/** The production sign-in email's text part, link first and the code alone on a later line. */
const signInText = (code: string): string =>
  [
    "Sign in to Better Answers with this link, in the browser where you asked:",
    "",
    "https://app.better-answers.example/sign-in/link#482913",
    "",
    "Or enter this code there:",
    "",
    code,
    "",
    "The link and the code work once, for five minutes.",
  ].join("\n");

let sent = 0;
const mail = (code: string, overrides: Partial<Mail> = {}): Mail => {
  sent += 1;
  return {
    id: `0000-${String(sent).padStart(4, "0")}`,
    to: [PERSON],
    from: PRODUCTION,
    text: signInText(code),
    html: "<p>999999</p>",
    authentication: ALIGNED,
    ...overrides,
  };
};

const listed = (one: Mail) => ({
  id: one.id,
  to: one.to,
  from: one.from,
  created_at: "2026-10-02T02:35:14.000Z",
  subject: "Sign in to Better Answers",
  bcc: [],
  cc: [],
  reply_to: [],
  message_id: `<${one.id}@mail.better-answers.example>`,
  attachments: [],
});

const retrieved = (one: Mail) => ({
  object: "email",
  ...listed(one),
  html: one.html,
  html_format: "data_uri",
  text: one.text,
  headers: { from: one.from },
  received_for: one.to,
  authentication: one.authentication,
  raw: null,
});

/** Resend's cursor rule: a page starts after the `after` id, and no `limit` means every item. */
const pageOf = (inbox: readonly Mail[], query: URLSearchParams) => {
  const after = query.get("after");
  const start = after === null ? 0 : inbox.findIndex((one) => one.id === after) + 1;
  const end = start + Number(query.get("limit") ?? inbox.length);
  return {
    object: "list",
    has_more: end < inbox.length,
    data: inbox.slice(start, end).map(listed),
  };
};

type Answer = { readonly status: number; readonly body: string };

const NOT_FOUND: Answer = { status: 404, body: JSON.stringify({ name: "not_found" }) };
const REFUSED: Answer = { status: 401, body: JSON.stringify({ name: "missing_api_key" }) };

const answerTo = (inbox: readonly Mail[], url: URL, authorization: string | undefined): Answer => {
  if (authorization !== `Bearer ${KEY}`) return REFUSED;
  if (url.pathname === "/emails/receiving") {
    return { status: 200, body: JSON.stringify(pageOf(inbox, url.searchParams)) };
  }
  const id = /^\/emails\/receiving\/([^/]+)$/.exec(url.pathname)?.[1];
  const found = inbox.find((one) => one.id === id);
  return found === undefined || found.vanished === true
    ? NOT_FOUND
    : { status: 200, body: JSON.stringify(retrieved(found)) };
};

type Heard = {
  readonly url: URL;
  readonly authorization: string | undefined;
  readonly userAgent: string | undefined;
};

type StandIn = {
  readonly origin: string;
  readonly heard: readonly Heard[];
  /** Each in turn, so the last named is the newest. */
  readonly arrive: (...arriving: readonly Mail[]) => void;
  readonly answerEverythingWith: (answer: Answer) => void;
  readonly close: () => Promise<void>;
};

const closers: (() => Promise<void>)[] = [];

/** A stand-in for Resend's receiving API, listing its inbox newest first as Resend does. */
const standIn = async (...before: readonly Mail[]): Promise<StandIn> => {
  const inbox: Mail[] = before.toReversed();
  const heard: Heard[] = [];
  let failure: Answer | undefined;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const { authorization, "user-agent": userAgent } = request.headers;
    heard.push({ url, authorization, userAgent });
    const { status, body } = failure ?? answerTo(inbox, url, authorization);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = (): Promise<void> => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  };
  closers.push(close);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port to listen on");
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    heard,
    arrive: (...arriving) => inbox.unshift(...arriving.toReversed()),
    answerEverythingWith: (answer) => {
      failure = answer;
    },
    close,
  };
};

const DEADLINE_MS = 400;

const watching = (inbox: StandIn) => ({
  apiUrl: inbox.origin,
  recipient: PERSON,
  sender: PRODUCTION,
  deadlineMs: DEADLINE_MS,
  pollIntervalMs: 10,
});

const notedOf = async (inbox: StandIn, overrides: Partial<Inbox> = {}) => {
  const noted = await noteInbox({ ...watching(inbox), ...overrides });
  if (noted.answer !== "noted") throw new Error(`the inbox answered ${noted.answer}`);
  return noted;
};

/** Notes the inbox, lets `arriving` land as a Send would, then waits for the code. */
const codeAfter = async (inbox: StandIn, ...arriving: readonly Mail[]) => {
  const noted = await noteInbox(watching(inbox));
  if (noted.answer !== "noted") return noted;
  inbox.arrive(...arriving);
  return noted.codeSent();
};

const listCalls = (inbox: StandIn): readonly URL[] =>
  inbox.heard.map(({ url }) => url).filter((url) => url.pathname === "/emails/receiving");

beforeEach(() => {
  vi.stubEnv("JOURNEYS_INBOX_KEY", KEY);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("noteInbox", () => {
  it("reads the code from the text part, never the link", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, mail("305117"))).toEqual({ answer: "code", code: "305117" });
  });

  it("reads the code from a text part with CRLF lines", async () => {
    const inbox = await standIn();
    const crlf = mail("305117", { text: signInText("305117").replaceAll("\n", "\r\n") });

    expect(await codeAfter(inbox, crlf)).toEqual({ answer: "code", code: "305117" });
  });

  it("ignores a message already in the inbox before the Send", async () => {
    const inbox = await standIn(mail("111111"));

    expect(await codeAfter(inbox, mail("222222"))).toEqual({ answer: "code", code: "222222" });
  });

  it("answers no-mail when only an older message holds a code", async () => {
    const inbox = await standIn(mail("111111"));

    expect(await codeAfter(inbox)).toEqual({ answer: "no-mail" });
  });

  it("ignores a new message to another address", async () => {
    const inbox = await standIn();
    const elsewhere = mail("111111", { to: [SOMEONE_ELSE] });

    expect(await codeAfter(inbox, elsewhere, mail("222222"))).toEqual({
      answer: "code",
      code: "222222",
    });
  });

  it.each([LOOKALIKE, `Better Answers <${LOOKALIKE}>`])(
    "ignores the person's new message from %s",
    async (from) => {
      const inbox = await standIn();

      expect(await codeAfter(inbox, mail("111111", { from }), mail("222222"))).toEqual({
        answer: "code",
        code: "222222",
      });
    },
  );

  it.each([
    [[PERSON], `Better Answers <${PRODUCTION}>`],
    [["Admin@Journeys.Example"], PRODUCTION.toUpperCase()],
    [[SOMEONE_ELSE, `Admin <${PERSON}>`], PRODUCTION],
  ])("matches addresses whatever their case or name: %j", async (to, from) => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, mail("305117", { to, from }))).toEqual({
      answer: "code",
      code: "305117",
    });
  });

  it("answers ambiguous when two new messages reach the person", async () => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, mail("111111"), mail("222222"))).toEqual({
      answer: "ambiguous",
    });
  });

  it.each([
    { spf: "fail", dkim: "fail", dmarc: "fail" },
    { spf: "gray", dkim: "gray", dmarc: "gray" },
    { spf: "pass", dkim: "gray", dmarc: "fail" },
    { spf: "pass", dkim: "unknown", dmarc: "processing_failed" },
  ])("answers ambiguous when authentication does not align: %j", async (authentication) => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, mail("305117", { authentication }))).toEqual({
      answer: "ambiguous",
    });
  });

  it.each([
    { spf: "gray", dkim: "pass", dmarc: "gray" },
    { spf: "pass", dkim: "gray", dmarc: "pass" },
  ])("reads the code when DKIM or DMARC aligns: %j", async (authentication) => {
    const inbox = await standIn();

    expect(await codeAfter(inbox, mail("305117", { authentication }))).toEqual({
      answer: "code",
      code: "305117",
    });
  });

  it.each([null, undefined])(
    "skips alignment when Resend returns no results: %s",
    async (authentication) => {
      const inbox = await standIn();

      expect(await codeAfter(inbox, mail("305117", { authentication }))).toEqual({
        answer: "code",
        code: "305117",
      });
    },
  );

  it.each([null, "Your code is 305117.", "3051170", "Or enter this code there:\n 305117"])(
    "answers no-code without a six-digit line: case %#",
    async (text) => {
      const inbox = await standIn();

      expect(await codeAfter(inbox, mail("305117", { text }))).toEqual({ answer: "no-code" });
    },
  );

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
    const answer = noted.codeSent();
    await vi.waitFor(() => {
      expect(listCalls(inbox).length).toBeGreaterThan(2);
    });
    inbox.arrive(mail("305117"));

    expect(await answer).toEqual({ answer: "code", code: "305117" });
  });

  it("finds a matching message on the list's second page", async () => {
    const inbox = await standIn(mail("111111"));
    const others = Array.from({ length: 101 }, () => mail("444444", { to: [SOMEONE_ELSE] }));

    expect(await codeAfter(inbox, mail("305117"), ...others)).toEqual({
      answer: "code",
      code: "305117",
    });
    expect(listCalls(inbox).some((url) => url.searchParams.get("after") === others[1]?.id)).toBe(
      true,
    );
  });

  it("stops paging at the first message it noted", async () => {
    const before = Array.from({ length: 150 }, () => mail("111111", { to: [SOMEONE_ELSE] }));
    const inbox = await standIn(...before);
    const noted = await notedOf(inbox);
    const notingCalls = listCalls(inbox).length;
    inbox.arrive(mail("305117"));

    expect(await noted.codeSent()).toEqual({ answer: "code", code: "305117" });
    expect(listCalls(inbox).length - notingCalls).toBe(1);
  });

  it("sends the key as a bearer token, with an agent", async () => {
    const inbox = await standIn();

    await codeAfter(inbox, mail("305117"));

    expect(inbox.heard.length).toBe(3);
    for (const { authorization, userAgent } of inbox.heard) {
      expect(authorization).toBe(`Bearer ${KEY}`);
      expect(userAgent).toBe("better-answers-journeys");
    }
  });

  it("answers unreachable when the inbox refuses the key", async () => {
    vi.stubEnv("JOURNEYS_INBOX_KEY", "re_revoked_key");
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
    { status: 401, body: JSON.stringify({ name: "restricted_api_key" }) },
    { status: 429, body: JSON.stringify({ name: "rate_limit_exceeded" }) },
    { status: 500, body: JSON.stringify({ name: "application_error" }) },
    { status: 200, body: "{" },
    { status: 200, body: JSON.stringify({ object: "list", data: "none" }) },
  ])("answers unreachable when the inbox answers %j", async (answer) => {
    const inbox = await standIn();
    const noted = await notedOf(inbox);
    inbox.answerEverythingWith(answer);
    inbox.arrive(mail("305117"));

    expect(await noted.codeSent()).toEqual({ answer: "unreachable" });
    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
  });

  it("answers unreachable when a retrieve fails", async () => {
    const inbox = await standIn();
    const noted = await notedOf(inbox);
    inbox.arrive(mail("305117", { vanished: true }));

    expect(await noted.codeSent()).toEqual({ answer: "unreachable" });
  });

  it("answers unreachable when nothing listens", async () => {
    const inbox = await standIn();
    await inbox.close();

    expect(await noteInbox(watching(inbox))).toEqual({ answer: "unreachable" });
  });
});
