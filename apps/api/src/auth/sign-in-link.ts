import { AsyncLocalStorage } from "node:async_hooks";

import { z } from "zod";

import {
  type PostgresDoor,
  withIdentityRead,
  withIdentityWrite,
} from "@better-answers/core/store/postgres";
import {
  SIGN_IN_CODE_PREFIX,
  SIGN_IN_LINK_PREFIX,
  type SignInMethod,
} from "@better-answers/core/workspaces";

import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import { EMAIL_CODE_LIFETIME_SECONDS, SIGN_IN_LINK_PAGE } from "./constants.ts";
import { hashOf, type LinkRead, mintLinkToken, seal } from "./link-token.ts";

/** What a code request hands its email: the nonce its cookie will hold, and any flow it carries. */
type LinkAsk = { readonly nonce: string; readonly carried: string };

/** The library's body validation drops the carried flow before its email hook runs. */
const asks = new AsyncLocalStorage<LinkAsk>();

/** Never a header, which any caller of the library's own sign-in could set. */
const linkSignIns = new AsyncLocalStorage<SignInMethod>();

export const askingWithALink = <T>(ask: LinkAsk, work: () => Promise<T>): Promise<T> =>
  asks.run(ask, work);

export const signingInByLink = <T>(work: () => Promise<T>): Promise<T> =>
  linkSignIns.run("email_link", work);

export const signInMethodOfThisCall = (): SignInMethod => linkSignIns.getStore() ?? "email_code";

type LinkStore = {
  readonly door: PostgresDoor;
  readonly secret: string;
  readonly publicUrl: string;
};

const identifierOf = (email: string): string => `${SIGN_IN_LINK_PREFIX}${email.toLowerCase()}`;

/** Replaces the address's earlier link in one write. A code asked outside a route gets none. */
export const keepALink = async (
  store: LinkStore,
  email: string,
  code: string,
): Promise<string | undefined> => {
  const ask = asks.getStore();
  if (ask === undefined) return undefined;
  const token = mintLinkToken();
  const id = hashOf(token);
  const identifier = identifierOf(email);
  const value = JSON.stringify({
    nonce: hashOf(ask.nonce),
    sealed: seal(token, store.secret, id, { code, carried: ask.carried }),
  });
  await withIdentityWrite(IDENTITY_PRINCIPAL, store.door, async (tx) => {
    await tx.query("DELETE FROM verification WHERE identifier = $1", [identifier]);
    await tx.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), now(), now())`,
      [id, identifier, value, EMAIL_CODE_LIFETIME_SECONDS],
    );
  });
  return `${store.publicUrl}${SIGN_IN_LINK_PAGE}#${token}`;
};

/** The link's row, and its address's code row beside it, each judged against the database's clock. */
const READ_A_LINK = `
  SELECT l.identifier, l.value, l.expires_at > now() AS link_live,
         c.value AS code_value, c.expires_at > now() AS code_live, c.expires_at AS code_expires_at
    FROM verification l
    LEFT JOIN LATERAL (
      SELECT value, expires_at FROM verification
       WHERE identifier = $3 || substr(l.identifier, length($2) + 1)
       ORDER BY created_at DESC LIMIT 1
    ) c ON true
   WHERE l.id = $1 AND starts_with(l.identifier, $2)`;

const linkRow = z.object({
  identifier: z.string(),
  value: z.string(),
  link_live: z.boolean(),
  code_value: z.string().nullable(),
  code_live: z.boolean().nullable(),
  code_expires_at: z.date().nullable(),
});

const linkValue = z.object({ nonce: z.string(), sealed: z.string() });

const keptValueOf = (text: string): z.infer<typeof linkValue> | undefined => {
  try {
    return linkValue.safeParse(JSON.parse(text)).data;
  } catch {
    // A value that is not the JSON this module writes was not written by it: no link.
    return undefined;
  }
};

const codeOf = (row: z.infer<typeof linkRow>): LinkRead["code"] =>
  row.code_value === null || row.code_live === null || row.code_expires_at === null
    ? undefined
    : {
        live: row.code_live,
        value: row.code_value,
        expiresAt: row.code_expires_at.toISOString(),
      };

/** Undefined when no link answers to `token`. */
export const readALink = async (
  door: PostgresDoor,
  token: string,
): Promise<LinkRead | undefined> => {
  const read = await withIdentityRead(IDENTITY_PRINCIPAL, door, (tx) =>
    tx.query(READ_A_LINK, [hashOf(token), SIGN_IN_LINK_PREFIX, SIGN_IN_CODE_PREFIX]),
  );
  const row = linkRow.safeParse(read.rows[0]);
  if (!row.success) return undefined;
  const kept = keptValueOf(row.data.value);
  if (kept === undefined) return undefined;
  return {
    address: row.data.identifier.slice(SIGN_IN_LINK_PREFIX.length),
    nonceHash: kept.nonce,
    sealed: kept.sealed,
    linkLive: row.data.link_live,
    code: codeOf(row.data),
  };
};

export const dropALink = async (door: PostgresDoor, token: string): Promise<void> => {
  await withIdentityWrite(IDENTITY_PRINCIPAL, door, (tx) =>
    tx.query("DELETE FROM verification WHERE id = $1", [hashOf(token)]),
  );
};
