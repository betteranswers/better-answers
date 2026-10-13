import { expect, type APIResponse, type Page } from "@playwright/test";
import { z } from "zod";

import { refusedTheRun } from "./sign-in.ts";

/** Named, not imported: the SPA's tRPC client module brings React's own with it. */
const TRPC = "/trpc";

const asked = async (page: Page, procedure: string): Promise<APIResponse> => {
  const answered = await page.request.get(`${TRPC}/${procedure}`);
  refusedTheRun(answered, `the read of ${procedure}`);
  return answered;
};

const readFrom = async <T>(
  answered: APIResponse,
  procedure: string,
  data: z.ZodType<T>,
): Promise<T> => {
  expect(answered.ok(), `${procedure} answered ${answered.status()}`).toBe(true);
  return z.object({ result: z.object({ data }) }).parse(await answered.json()).result.data;
};

/** Through the person's own session, as their page asks it, so it reads what they may read. */
const readThroughTheSession = async <T>(
  page: Page,
  procedure: string,
  data: z.ZodType<T>,
): Promise<T> => readFrom(await asked(page, procedure), procedure, data);

/** A batch's address names its procedures in the order of its answers; a call sent alone names one. */
const askedAt = (url: string): readonly string[] =>
  new URL(url).pathname.replace(`${TRPC}/`, "").split(",");

/** Asked for before the journey's own action that calls, or the answer can land unwaited for. */
const answerTo = async <T>(page: Page, procedure: string, data: z.ZodType<T>): Promise<T> => {
  const answered = await page.waitForResponse((answer) =>
    askedAt(answer.url()).includes(procedure),
  );
  refusedTheRun(answered, `the page's call of ${procedure}`);
  expect(answered.ok(), `${procedure} answered ${answered.status()}`).toBe(true);
  const answers: unknown = await answered.json();
  const answer = Array.isArray(answers)
    ? answers[askedAt(answered.url()).indexOf(procedure)]
    : answers;
  return z.object({ result: z.object({ data }) }).parse(answer).result.data;
};

/** The api's refusal of an action: its word, alone, as the message. An edge or a failure says none. */
const REFUSED = z.object({
  error: z.object({ message: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }),
});

const refusalWordOf = (text: string): string | undefined => {
  try {
    const refused = REFUSED.safeParse(JSON.parse(text));
    return refused.success ? refused.data.error.message : undefined;
  } catch {
    // An edge answers in HTML, which holds no refusal of the product's.
    return undefined;
  }
};

const refusalWordIn = async (answered: APIResponse): Promise<string | undefined> =>
  answered.ok() ? undefined : refusalWordOf(await answered.text());

/** What a read through the Admin's session found, or the word the product refused it with. */
export type Checked<T> =
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "refused"; readonly procedure: string; readonly word: string };

const checkedThroughTheSession = async <T>(
  page: Page,
  procedure: string,
  data: z.ZodType<T>,
): Promise<Checked<T>> => {
  const answered = await asked(page, procedure);
  const word = await refusalWordIn(answered);
  if (word !== undefined) return { kind: "refused", procedure, word };
  return { kind: "read", value: await readFrom(answered, procedure, data) };
};

const PROTECTED_RESOURCE = z.object({ resource: z.string() });

/** The address the release publishes for an assistant to connect to, read as an assistant reads it. */
export const publishedAddressOf = async (page: Page): Promise<string> => {
  const answered = await page.request.get("/.well-known/oauth-protected-resource/mcp");
  refusedTheRun(answered, "the read of the protected-resource document");
  expect(answered.ok(), `the protected-resource document answered ${answered.status()}`).toBe(true);
  return PROTECTED_RESOURCE.parse(await answered.json()).resource;
};

const SESSION_MEMBER = z.object({
  workspace: z.object({ name: z.string() }),
  person: z.object({ name: z.string() }),
});

type SessionMember = z.output<typeof SESSION_MEMBER>;

export const sessionMemberOf = (page: Page): Promise<SessionMember> =>
  readThroughTheSession(page, "session.member", SESSION_MEMBER);

const ROLE_HELD = z.object({ role: z.string() });

export const roleOfTheAdmin = async (page: Page): Promise<Checked<string>> => {
  const held = await checkedThroughTheSession(page, "session.member", ROLE_HELD);
  return held.kind === "read" ? { kind: "read", value: held.value.role } : held;
};

const MEMBERS = z.array(
  z.object({ displayName: z.string(), address: z.string(), role: z.string() }),
);

export type Member = z.output<typeof MEMBERS>[number];

const INVITATION_COUNTS = z.object({ waiting: z.number() });

const CONNECTED_SOURCES = z.array(z.unknown());

export type StandingRead = {
  readonly members: readonly Member[];
  readonly waitingInvitations: number;
  readonly connectedSources: number;
};

/** The three reads the fixture check judges; the first refusal, if any, stands for them all. */
export const standingOf = async (page: Page): Promise<Checked<StandingRead>> => {
  const [members, counts, connectedSources] = await Promise.all([
    checkedThroughTheSession(page, "members.list", MEMBERS),
    checkedThroughTheSession(page, "members.invitationCounts", INVITATION_COUNTS),
    checkedThroughTheSession(page, "sources.list", CONNECTED_SOURCES),
  ]);
  if (members.kind === "refused") return members;
  if (counts.kind === "refused") return counts;
  if (connectedSources.kind === "refused") return connectedSources;
  return {
    kind: "read",
    value: {
      members: members.value,
      waitingInvitations: counts.value.waiting,
      connectedSources: connectedSources.value.length,
    },
  };
};

/** The api's answer to an action of the journey's own, with nothing read from it. */
export const answeredOk = async (page: Page, procedure: string): Promise<void> => {
  await answerTo(page, procedure, z.unknown());
};

/** How many the page's own read of the connected sources lists. */
export const connectedSourcesRead = async (page: Page): Promise<number> =>
  (await answerTo(page, "sources.list", CONNECTED_SOURCES)).length;

const BULK_CHANGED = z.object({ changed: z.array(z.unknown()), skipped: z.number() });

/** How many a bulk action the journey committed changed, and how many it passed over. */
export const bulkAnswerTo = async (
  page: Page,
  procedure: string,
): Promise<{ readonly changed: number; readonly skipped: number }> => {
  const { changed, skipped } = await answerTo(page, procedure, BULK_CHANGED);
  return { changed: changed.length, skipped };
};

const GROUPS = z.array(z.object({ name: z.string() }));

export const groupNamesOf = async (page: Page): Promise<readonly string[]> =>
  (await readThroughTheSession(page, "members.groups", GROUPS)).map((group) => group.name);
