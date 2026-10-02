import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { generateRandomString } from "better-auth/crypto";
import { z } from "zod";

import { EMAIL_CODE_ATTEMPTS } from "./constants.ts";

const TOKEN_LENGTH = 43;
const NONCE_BYTES = 32;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_INFO = "better-answers sign-in link";

/** About 256 bits, in letters and digits alone, so it reads whole in any mail client. */
export const mintLinkToken = (): string => generateRandomString(TOKEN_LENGTH, "a-z", "A-Z", "0-9");

export const mintNonce = (): string => randomBytes(NONCE_BYTES).toString("base64url");

/** The only form of a token or a nonce the database holds. */
export const hashOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** What a link seals: its code, and the signed query of a flow the code request carried. */
export type Opened = { readonly code: string; readonly carried: string };

const opened = z.strictObject({ code: z.string(), carried: z.string() });

const keyOf = (token: string, salt: string): Buffer =>
  Buffer.from(hkdfSync("sha256", token, salt, KEY_INFO, KEY_BYTES));

/** `boundTo` is authenticated with the contents, so a sealed value moved to another row opens nowhere. */
export const seal = (token: string, salt: string, boundTo: string, contents: Opened): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyOf(token, salt), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(boundTo));
  const body = Buffer.concat([cipher.update(JSON.stringify(contents), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
};

const openedFrom = (
  token: string,
  salt: string,
  boundTo: string,
  bytes: Buffer,
): Opened | undefined => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyOf(token, salt),
    bytes.subarray(0, IV_BYTES),
    {
      authTagLength: TAG_BYTES,
    },
  );
  decipher.setAAD(Buffer.from(boundTo));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  const body = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
  const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  return opened.safeParse(JSON.parse(text)).data;
};

/** Undefined for a wrong token, a wrong row, or contents altered since they were sealed. */
export const unseal = (
  token: string,
  salt: string,
  boundTo: string,
  sealed: string,
): Opened | undefined => {
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) return undefined;
  try {
    return openedFrom(token, salt, boundTo, bytes);
  } catch {
    // The cipher throws on a failed tag; a link that will not open is a dead link, nothing more.
    return undefined;
  }
};

/** Whether the cookie a request carried holds the nonce the link was bound to. */
export const isBound = (cookie: string | undefined, nonceHash: string): boolean => {
  if (cookie === undefined) return false;
  const offered = Buffer.from(hashOf(cookie), "hex");
  const kept = Buffer.from(nonceHash, "hex");
  return offered.length === kept.length && timingSafeEqual(offered, kept);
};

/** A link's row and its code's, as read together: each with whether it is still within its time. */
export type LinkRead = {
  readonly address: string;
  readonly nonceHash: string;
  readonly sealed: string;
  readonly linkLive: boolean;
  readonly code:
    | { readonly live: boolean; readonly value: string; readonly expiresAt: string }
    | undefined;
};

export type LinkState =
  | { readonly state: "bound"; readonly address: string; readonly carriedOn: "connecting" | null }
  | { readonly state: "elsewhere"; readonly code: string; readonly until: string }
  | { readonly state: "dead" };

export const DEAD_LINK: LinkState = { state: "dead" };

/** The library keeps a code as `<hash>:<tries spent>`. */
const triesSpentOn = (value: string): number => Number(value.slice(value.lastIndexOf(":") + 1));

const codeLive = (code: LinkRead["code"]): code is NonNullable<LinkRead["code"]> =>
  code !== undefined && code.live && triesSpentOn(code.value) < EMAIL_CODE_ATTEMPTS;

/** One answer for every dead link, so a read never says whether a token was ever real. */
export const linkStateOf = (
  read: LinkRead | undefined,
  contents: Opened | undefined,
  bound: boolean,
): LinkState => {
  if (read === undefined || !read.linkLive || contents === undefined) return DEAD_LINK;
  if (!codeLive(read.code)) return DEAD_LINK;
  if (bound) {
    return {
      state: "bound",
      address: read.address,
      carriedOn: contents.carried === "" ? null : "connecting",
    };
  }
  return { state: "elsewhere", code: contents.code, until: read.code.expiresAt };
};
