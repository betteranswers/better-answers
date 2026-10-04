import { expect, type APIResponse, type Page } from "@playwright/test";
import { z } from "zod";

import { refusedTheRun } from "./sign-in.ts";

/** Named, not imported: the SPA's client module brings its React bindings with it. */
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

/** The api's refusal of an act: its word, alone, as the message. An edge or a failure says none. */
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

const MEMBERSHIP = z.object({
  workspace: z.object({ name: z.string() }),
  person: z.object({ name: z.string() }),
});

type Membership = z.output<typeof MEMBERSHIP>;

export const membershipOf = (page: Page): Promise<Membership> =>
  readThroughTheSession(page, "session.membership", MEMBERSHIP);

const ROLE_HELD = z.object({ role: z.string() });

export const roleOfTheAdmin = async (page: Page): Promise<Checked<string>> => {
  const held = await checkedThroughTheSession(page, "session.membership", ROLE_HELD);
  return held.kind === "read" ? { kind: "read", value: held.value.role } : held;
};

const MEMBERS = z.array(
  z.object({ displayName: z.string(), address: z.string(), role: z.string() }),
);

export type Member = z.output<typeof MEMBERS>[number];

const INVITATION_COUNTS = z.object({ waiting: z.number() });

const BINDINGS = z.array(z.unknown());

export type StandingRead = {
  readonly members: readonly Member[];
  readonly waitingInvitations: number;
  readonly bindings: number;
};

/** The three reads the fixture check judges; the first refusal, if any, stands for them all. */
export const standingOf = async (page: Page): Promise<Checked<StandingRead>> => {
  const [members, counts, bindings] = await Promise.all([
    checkedThroughTheSession(page, "members.list", MEMBERS),
    checkedThroughTheSession(page, "members.invitationCounts", INVITATION_COUNTS),
    checkedThroughTheSession(page, "sources.list", BINDINGS),
  ]);
  if (members.kind === "refused") return members;
  if (counts.kind === "refused") return counts;
  if (bindings.kind === "refused") return bindings;
  return {
    kind: "read",
    value: {
      members: members.value,
      waitingInvitations: counts.value.waiting,
      bindings: bindings.value.length,
    },
  };
};

const GROUPS = z.array(z.object({ name: z.string() }));

export const groupNamesOf = async (page: Page): Promise<readonly string[]> =>
  (await readThroughTheSession(page, "members.groups", GROUPS)).map((group) => group.name);
