import { Resolver } from "node:dns/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { DKIMResult, DKIMVerifyResult, DNSResolver } from "mailauth";
import { dkimVerify } from "mailauth/lib/dkim/verify.js";
import { simpleParser, type ParsedMail } from "mailparser";
import { z } from "zod";

import {
  TEST_INBOX_MESSAGE,
  TEST_INBOX_PAGE,
  type TestInboxListed,
  type TestInboxMessage,
  type TestInboxPage,
} from "@better-answers/schema/test-inbox";

const USER_AGENT = "better-answers-journeys";
const PAGE_LIMIT = 100;
const DEADLINE_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const LOOKUP_TIMEOUT_MS = 2_000;

/** Alone on its line, so digits in the link are never read as it. */
const SIGN_IN_CODE = /^(\d{6})$/m;

export type Inbox = {
  readonly recipient: string;
  readonly sender: string;
  readonly apiUrl: URL;
  /** Answers a signing key's TXT record: the runner's own DNS, unless a test answers it. */
  readonly keyLookup?: DNSResolver;
  /** Counted from the call to `codeSent`. */
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
  readonly lookupTimeoutMs?: number;
};

export type InboxAnswer =
  | { readonly answer: "code"; readonly code: string }
  | {
      readonly answer: "no-mail" | "no-code" | "ambiguous" | "unverified" | "unreachable";
    };

export type Noted =
  | {
      readonly answer: "noted";
      /** Ask again after a refused code: one rotated since reads as ambiguous, not as a failure. */
      readonly codeSent: () => Promise<InboxAnswer>;
    }
  | { readonly answer: "unreachable" };

const UNREACHABLE = { answer: "unreachable" } as const;
const AMBIGUOUS = { answer: "ambiguous" } as const;
const UNVERIFIED = { answer: "unverified" } as const;
const NO_MAIL = { answer: "no-mail" } as const;
const NO_CODE = { answer: "no-code" } as const;

const PROBED = z.object({ probed: z.literal(true) });

const KEY = z.string().min(1);

const inboxKey = (): string | undefined => {
  // Read here alone, so no caller ever holds the key to print it.
  const parsed = KEY.safeParse(process.env["JOURNEYS_INBOX_KEY"]);
  return parsed.success ? parsed.data : undefined;
};

const fetched = async <T>(
  url: URL,
  key: string,
  schema: z.ZodType<T>,
  method = "GET",
): Promise<T | undefined> => {
  try {
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${key}`, "user-agent": USER_AGENT },
      // Following one would carry the key wherever it points.
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    // A refused connection, a redirect, a timeout and a body that is not JSON all mean no answer.
    return undefined;
  }
};

type Client = {
  readonly page: (after: string | undefined) => Promise<TestInboxPage | undefined>;
  readonly message: (id: string) => Promise<TestInboxMessage | undefined>;
};

const clientOf = (apiUrl: URL, key: string): Client => ({
  page: (after) => {
    const url = new URL("/emails/receiving", apiUrl);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (after !== undefined) url.searchParams.set("after", after);
    return fetched(url, key, TEST_INBOX_PAGE);
  },
  message: (id) =>
    fetched(
      new URL(`/emails/receiving/${encodeURIComponent(id)}`, apiUrl),
      key,
      TEST_INBOX_MESSAGE,
    ),
});

/** The resolver's own timeout is per try and per server, so this bound is the one that holds. */
const bounded =
  (lookup: DNSResolver, timeoutMs: number): DNSResolver =>
  (name, rrtype) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const cut = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("the key lookup timed out")), {
        once: true,
      });
    });
    return Promise.race([lookup(name, rrtype), cut]);
  };

/** A signing key is a TXT record, the only kind the verifier asks for. */
const runnersDns: DNSResolver = (name) =>
  new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 }).resolveTxt(name);

/**
 * Only the sender's domain vouches, and the verifier asks for each signature's key in turn, so a
 * forger's many domains would otherwise outlast the sign-in.
 */
const sendersOwn =
  (lookup: DNSResolver, senderDomain: string): DNSResolver =>
  (name, rrtype) =>
    name.toLowerCase().endsWith(`._domainkey.${senderDomain}`)
      ? lookup(name, rrtype)
      : Promise.reject(Object.assign(new Error("not the sender's key"), { code: "ENODATA" }));

type Watch = {
  readonly client: Client;
  readonly noted: ReadonlySet<string>;
  readonly recipient: string;
  readonly sender: string;
  readonly senderDomain: string;
  readonly keyLookup: DNSResolver;
};

/** The inbox lists newest first, so everything from the first noted message on was there before. */
const arrivalsAfter = async (
  watch: Watch,
  after: string | undefined,
): Promise<readonly TestInboxListed[] | undefined> => {
  const page = await watch.client.page(after);
  if (page === undefined) return undefined;
  const firstNoted = page.data.findIndex(({ id }) => watch.noted.has(id));
  if (firstNoted !== -1) return page.data.slice(0, firstNoted);
  const last = page.data.at(-1);
  if (!page.has_more || last === undefined) return page.data;
  const older = await arrivalsAfter(watch, last.id);
  return older === undefined ? undefined : [...page.data, ...older];
};

const addressOf = (mailbox: string): string =>
  (/<([^<>]*)>\s*$/.exec(mailbox)?.[1] ?? mailbox).trim().toLowerCase();

const isCandidate = (watch: Watch, listed: TestInboxListed): boolean =>
  addressOf(listed.from) === watch.sender &&
  listed.to.some((to) => addressOf(to) === watch.recipient);

/** A message the sender's own signature vouches for, with the text part its code is read from. */
type Vouched = { readonly messageId: string; readonly text: string };

const SET_ASIDE = "set aside";

/** Judged once; a message whose key could not be looked up is not judged yet. */
type Verdict = Vouched | typeof SET_ASIDE;

const LOOK_AGAIN = "look again";

const signedFields = (result: DKIMResult): readonly string[] =>
  (result.signingHeaders?.keys ?? "").split(":").map((field) => field.trim().toLowerCase());

/**
 * Over the whole body, since content appended past an `l=` would pass. The verifier already fails
 * a signature leaving From unsigned.
 */
const vouches = (result: DKIMResult, domain: string): boolean =>
  result.status.result === "pass" &&
  result.signingDomain?.toLowerCase() === domain &&
  result.canonBodyLengthLimited !== true &&
  signedFields(result).includes("to");

const fieldCount = (verified: DKIMVerifyResult, name: string): number =>
  verified.headers?.parsed.filter(({ key }) => key === name).length ?? 0;

/** A From or To added above the signed one leaves the signature passing. */
const singlyAddressed = (verified: DKIMVerifyResult): boolean =>
  fieldCount(verified, "from") === 1 && fieldCount(verified, "to") === 1;

/** A lookup that failed says nothing of the message; one that found no key does. */
const keyUnread = (verified: DKIMVerifyResult, domain: string): boolean =>
  verified.results.some(
    (result) =>
      result.signingDomain?.toLowerCase() === domain && result.status.result === "temperror",
  );

/** The text part alone, so an email that lost it reads as carrying no code. */
const PARSING = { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true } as const;

const addressesIn = (to: ParsedMail["to"]): readonly string[] =>
  [to ?? []]
    .flat()
    .flatMap(({ value }) => value)
    .flatMap((mailbox) => mailbox.group ?? [mailbox])
    .map(({ address }) => (address ?? "").toLowerCase());

/** A genuine email to someone else, re-sent to the person, names them nowhere it was signed. */
const readOf = async (watch: Watch, raw: Buffer, id: string): Promise<Verdict> => {
  const mail = await simpleParser(raw, PARSING);
  if (!addressesIn(mail.to).includes(watch.recipient)) return SET_ASIDE;
  return { messageId: mail.messageId ?? id, text: mail.text ?? "" };
};

const judged = async (
  watch: Watch,
  raw: Buffer,
  id: string,
): Promise<Verdict | typeof LOOK_AGAIN> => {
  try {
    const verified = await dkimVerify(raw, { resolver: watch.keyLookup });
    const vouched = verified.results.some((result) => vouches(result, watch.senderDomain));
    if (vouched && singlyAddressed(verified)) return await readOf(watch, raw, id);
    return keyUnread(verified, watch.senderDomain) ? LOOK_AGAIN : SET_ASIDE;
  } catch {
    // Bytes the verifier or the parser cannot read vouch for nothing, and must not end the wait.
    return SET_ASIDE;
  }
};

type Verdicts = ReadonlyMap<string, Verdict>;

/** The first unjudged candidate even past the deadline, so the last poll still reads what it lists. */
const withVerdicts = async (
  watch: Watch,
  verdicts: Verdicts,
  candidates: readonly TestInboxListed[],
  deadlineAt: number,
): Promise<Verdicts | undefined> => {
  let known = verdicts;
  for (const { id } of candidates.filter((candidate) => !verdicts.has(candidate.id))) {
    const message = await watch.client.message(id);
    if (message === undefined) return undefined;
    const verdict = await judged(watch, Buffer.from(message.raw, "base64"), id);
    if (verdict !== LOOK_AGAIN) known = new Map(known).set(id, verdict);
    if (Date.now() >= deadlineAt) return known;
  }
  return known;
};

const isVouched = (verdict: Verdict | undefined): verdict is Vouched => typeof verdict === "object";

/** Copies of one email share its Message-ID, so only a second Message-ID is a second email. */
const answerOf = (vouched: readonly Vouched[]): InboxAnswer | undefined => {
  const emails = new Map(vouched.map(({ messageId, text }) => [messageId, text]));
  if (emails.size > 1) return AMBIGUOUS;
  const [text] = emails.values();
  if (text === undefined) return undefined;
  const code = SIGN_IN_CODE.exec(text)?.[1];
  return code === undefined ? NO_CODE : { answer: "code", code };
};

type Poll = {
  /** Undefined while no email the sender vouches for has arrived for the person. */
  readonly answer: InboxAnswer | undefined;
  /** Kept for the re-ask, so an email vouched for once is never judged again. */
  readonly verdicts: Verdicts;
  readonly arrived: boolean;
};

const polled = async (watch: Watch, verdicts: Verdicts, deadlineAt: number): Promise<Poll> => {
  const arrivals = await arrivalsAfter(watch, undefined);
  if (arrivals === undefined) return { answer: UNREACHABLE, verdicts, arrived: false };
  const candidates = arrivals.filter((listed) => isCandidate(watch, listed));
  const known = await withVerdicts(watch, verdicts, candidates, deadlineAt);
  if (known === undefined) return { answer: UNREACHABLE, verdicts, arrived: true };
  const vouched = candidates.map(({ id }) => known.get(id)).filter(isVouched);
  return { answer: answerOf(vouched), verdicts: known, arrived: candidates.length > 0 };
};

type Timing = { readonly deadlineMs: number; readonly pollIntervalMs: number };

const codeWithin = async (watch: Watch, verdicts: Verdicts, timing: Timing): Promise<Poll> => {
  const deadlineAt = Date.now() + timing.deadlineMs;
  let poll = await polled(watch, verdicts, deadlineAt);
  while (poll.answer === undefined && Date.now() < deadlineAt) {
    await sleep(Math.min(timing.pollIntervalMs, deadlineAt - Date.now()));
    poll = await polled(watch, poll.verdicts, deadlineAt);
  }
  return poll;
};

const watchOf = (inbox: Inbox, client: Client, page: TestInboxPage): Watch => {
  const sender = addressOf(inbox.sender);
  const senderDomain = sender.slice(sender.lastIndexOf("@") + 1);
  const lookup = bounded(inbox.keyLookup ?? runnersDns, inbox.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS);
  return {
    client,
    noted: new Set(page.data.map(({ id }) => id)),
    recipient: addressOf(inbox.recipient),
    sender,
    senderDomain,
    keyLookup: sendersOwn(lookup, senderDomain),
  };
};

/**
 * Notes the inbox before Send. An inbox fault answers rather than throws, and no answer holds the
 * key or an address.
 */
export const noteInbox = async (inbox: Inbox): Promise<Noted> => {
  const key = inboxKey();
  if (key === undefined) return UNREACHABLE;
  const client = clientOf(inbox.apiUrl, key);
  const page = await client.page(undefined);
  if (page === undefined) return UNREACHABLE;
  const watch = watchOf(inbox, client, page);
  const timing: Timing = {
    deadlineMs: inbox.deadlineMs ?? DEADLINE_MS,
    pollIntervalMs: inbox.pollIntervalMs ?? POLL_INTERVAL_MS,
  };
  let verdicts: Verdicts = new Map();
  return {
    answer: "noted",
    codeSent: async () => {
      const poll = await codeWithin(watch, verdicts, timing);
      verdicts = poll.verdicts;
      // Only emails nobody vouched for, or whose key could not be looked up, ever arrived.
      return poll.answer ?? (poll.arrived ? UNVERIFIED : NO_MAIL);
    },
  };
};

/** Before any Send, so a store that cannot write stops the run rather than reading as no mail. */
export const probeInbox = async (apiUrl: URL): Promise<boolean> => {
  const key = inboxKey();
  if (key === undefined) return false;
  return (await fetched(new URL("/probe", apiUrl), key, PROBED, "POST")) !== undefined;
};
