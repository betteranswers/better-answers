import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "better-answers-journeys";
const PAGE_LIMIT = 100;
const DEADLINE_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Alone on its line, so digits in the link are never read as it; received mail may keep SMTP's `\r`. */
const SIGN_IN_CODE = /^(\d{6})\r?$/m;

export type Inbox = {
  readonly recipient: string;
  readonly sender: string;
  readonly apiUrl?: string;
  /** Counted from the call to `codeSent`. */
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
};

export type InboxAnswer =
  | { readonly answer: "code"; readonly code: string }
  | { readonly answer: "no-mail" | "no-code" | "ambiguous" | "unreachable" };

export type Noted =
  | {
      readonly answer: "noted";
      /** Ask again after a refused code: one rotated since reads as ambiguous, not as a failure. */
      readonly codeSent: () => Promise<InboxAnswer>;
    }
  | { readonly answer: "unreachable" };

const UNREACHABLE = { answer: "unreachable" } as const;
const AMBIGUOUS = { answer: "ambiguous" } as const;
const NO_MAIL = { answer: "no-mail" } as const;
const NO_CODE = { answer: "no-code" } as const;

const PAGE = z.object({
  has_more: z.boolean(),
  data: z.array(z.object({ id: z.string(), to: z.array(z.string()), from: z.string() })),
});
type Page = z.infer<typeof PAGE>;
type Listed = Page["data"][number];

const MESSAGE = z.object({
  text: z.string().nullish(),
  authentication: z.object({ dkim: z.string(), dmarc: z.string() }).nullish(),
});
type Message = z.infer<typeof MESSAGE>;

const KEY = z.string().min(1);

const inboxKey = (): string | undefined => {
  // Read here alone, so no caller ever holds the key to print it.
  const parsed = KEY.safeParse(process.env["JOURNEYS_INBOX_KEY"]);
  return parsed.success ? parsed.data : undefined;
};

const fetched = async <T>(url: URL, key: string, schema: z.ZodType<T>): Promise<T | undefined> => {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    // A refused connection, a timeout and a body that is not JSON all mean the same: no answer.
    return undefined;
  }
};

type Client = {
  readonly page: (after: string | undefined) => Promise<Page | undefined>;
  readonly message: (id: string) => Promise<Message | undefined>;
};

const clientOf = (apiUrl: string, key: string): Client => ({
  page: (after) => {
    const url = new URL("/emails/receiving", apiUrl);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (after !== undefined) url.searchParams.set("after", after);
    return fetched(url, key, PAGE);
  },
  message: (id) =>
    fetched(new URL(`/emails/receiving/${encodeURIComponent(id)}`, apiUrl), key, MESSAGE),
});

type Watch = {
  readonly client: Client;
  readonly noted: ReadonlySet<string>;
  readonly recipient: string;
  readonly sender: string;
};

/** Resend lists newest first, so everything from the first noted message on was there before. */
const arrivalsAfter = async (
  watch: Watch,
  after: string | undefined,
): Promise<readonly Listed[] | undefined> => {
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

const isCandidate = (watch: Watch, listed: Listed): boolean =>
  addressOf(listed.from) === watch.sender &&
  listed.to.some((to) => addressOf(to) === watch.recipient);

/** Resend computes these on receipt, against the From domain, so a sender cannot forge them. */
const aligned = (authentication: Message["authentication"]): boolean => {
  // Mail received before Resend computed them carries none, and novelty must stand alone.
  if (authentication === null || authentication === undefined) return true;
  return authentication.dkim === "pass" || authentication.dmarc === "pass";
};

const answerFrom = (message: Message | undefined): InboxAnswer => {
  if (message === undefined) return UNREACHABLE;
  if (!aligned(message.authentication)) return AMBIGUOUS;
  const code = SIGN_IN_CODE.exec(message.text ?? "")?.[1];
  return code === undefined ? NO_CODE : { answer: "code", code };
};

/** Undefined while nothing has arrived for the person. */
const polled = async (watch: Watch): Promise<InboxAnswer | undefined> => {
  const arrivals = await arrivalsAfter(watch, undefined);
  if (arrivals === undefined) return UNREACHABLE;
  const candidates = arrivals.filter((listed) => isCandidate(watch, listed));
  if (candidates.length > 1) return AMBIGUOUS;
  const candidate = candidates.at(0);
  return candidate === undefined ? undefined : answerFrom(await watch.client.message(candidate.id));
};

const codeWithin = async (
  watch: Watch,
  deadlineMs: number,
  pollIntervalMs: number,
): Promise<InboxAnswer> => {
  const deadlineAt = Date.now() + deadlineMs;
  let answer = await polled(watch);
  while (answer === undefined && Date.now() < deadlineAt) {
    await sleep(Math.min(pollIntervalMs, deadlineAt - Date.now()));
    answer = await polled(watch);
  }
  return answer ?? NO_MAIL;
};

/**
 * Notes the inbox before Send. An inbox fault answers rather than throws, and no answer holds the
 * key or an address.
 */
export const noteInbox = async (inbox: Inbox): Promise<Noted> => {
  const key = inboxKey();
  if (key === undefined) return UNREACHABLE;
  const client = clientOf(inbox.apiUrl ?? RESEND_API, key);
  const page = await client.page(undefined);
  if (page === undefined) return UNREACHABLE;
  const watch: Watch = {
    client,
    noted: new Set(page.data.map(({ id }) => id)),
    recipient: addressOf(inbox.recipient),
    sender: addressOf(inbox.sender),
  };
  const deadlineMs = inbox.deadlineMs ?? DEADLINE_MS;
  const pollIntervalMs = inbox.pollIntervalMs ?? POLL_INTERVAL_MS;
  return { answer: "noted", codeSent: () => codeWithin(watch, deadlineMs, pollIntervalMs) };
};
