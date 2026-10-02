import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { refusedTheRun } from "./sign-in.ts";

/** Named, not imported: the SPA's client module brings its React bindings with it. */
const TRPC = "/trpc";

/** Through the person's own session, as their screen asks it, so it reads what they may read. */
const readThroughTheSession = async <T>(
  page: Page,
  procedure: string,
  data: z.ZodType<T>,
): Promise<T> => {
  const answered = await page.request.get(`${TRPC}/${procedure}`);
  refusedTheRun(answered, `the read of ${procedure}`);
  expect(answered.ok(), `${procedure} answered ${answered.status()}`).toBe(true);
  return z.object({ result: z.object({ data }) }).parse(await answered.json()).result.data;
};

const MEMBERSHIP = z.object({
  workspace: z.object({ name: z.string() }),
  person: z.object({ name: z.string() }),
});

export type Membership = z.output<typeof MEMBERSHIP>;

export const membershipOf = (page: Page): Promise<Membership> =>
  readThroughTheSession(page, "session.membership", MEMBERSHIP);

const MEMBERS = z.array(
  z.object({ displayName: z.string(), address: z.string(), role: z.string() }),
);

export type Member = z.output<typeof MEMBERS>[number];

export const membersOf = (page: Page): Promise<readonly Member[]> =>
  readThroughTheSession(page, "members.list", MEMBERS);

export const waitingInvitationsOf = async (page: Page): Promise<number> =>
  (await readThroughTheSession(page, "members.invitationCounts", z.object({ waiting: z.number() })))
    .waiting;

export const bindingsOf = async (page: Page): Promise<number> =>
  (await readThroughTheSession(page, "sources.list", z.array(z.unknown()))).length;

export const groupNamesOf = async (page: Page): Promise<readonly string[]> =>
  (
    await readThroughTheSession(page, "members.groups", z.array(z.object({ name: z.string() })))
  ).map((group) => group.name);
