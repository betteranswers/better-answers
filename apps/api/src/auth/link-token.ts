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

import { EMAIL_CODE_ATTEMPTS } from "@better-answers/schema/email-code";

const TOKEN_LENGTH = 43;
const NONCE_BYTES = 32;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_INFO = "better-answers sign-in link";

export const mintLinkToken = (): string => generateRandomString(TOKEN_LENGTH, "a-z", "A-Z", "0-9");

export const mintNonce = (): string => randomBytes(NONCE_BYTES).toString("base64url");

export const hashOf = (secret: string): string => createHash("sha256").update(secret).digest("hex");

const opened = z.strictObject({ code: z.string(), carried: z.string(), returnTo: z.string() });

export type Opened = Readonly<z.infer<typeof opened>>;

const carriedQueryOf = (contents: Opened): string => {
  if (contents.carried !== "") return `?${contents.carried}`;
  return contents.returnTo === "" ? "" : `?redirect=${encodeURIComponent(contents.returnTo)}`;
};

const keyOf = (token: string, salt: string): Buffer =>
  Buffer.from(hkdfSync("sha256", token, salt, KEY_INFO, KEY_BYTES));

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

export const unseal = (
  token: string,
  salt: string,
  boundTo: string,
  sealed: string,
): Opened | undefined => {
  try {
    return openedFrom(token, salt, boundTo, Buffer.from(sealed, "base64url"));
  } catch {
    return undefined;
  }
};

export const isBound = (cookie: string | undefined, nonceHash: string): boolean => {
  if (cookie === undefined) return false;
  const offered = Buffer.from(hashOf(cookie), "hex");
  const kept = Buffer.from(nonceHash, "hex");
  return offered.length === kept.length && timingSafeEqual(offered, kept);
};

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
  | { readonly state: "bound"; readonly address: string; readonly carried: string }
  | { readonly state: "elsewhere"; readonly code: string; readonly until: string }
  | { readonly state: "dead" };

type BoundLink = Extract<LinkState, { readonly state: "bound" }>;

export const DEAD_LINK: Extract<LinkState, { readonly state: "dead" }> = { state: "dead" };

export type LinkUse = {
  readonly email: string;
  readonly code: string;
  readonly oauthQuery: string;
  readonly carried: string;
};

export type SeenLink = Exclude<LinkState, BoundLink> | (BoundLink & { readonly use: LinkUse });

export const shownOf = (link: SeenLink): LinkState =>
  link.state === "bound" ? { state: "bound", address: link.address, carried: link.carried } : link;

export const codeHashOf = (code: string): string =>
  createHash("sha256").update(code).digest("base64url");

/** The library keeps a code as `<hash>:<tries spent>`. */
const triesSpentOn = (value: string): number => Number(value.slice(value.lastIndexOf(":") + 1));

const hashKeptFor = (value: string): string => value.slice(0, value.lastIndexOf(":"));

const codeLive = (
  code: LinkRead["code"],
  sealedCode: string,
): code is NonNullable<LinkRead["code"]> =>
  code !== undefined &&
  code.live &&
  triesSpentOn(code.value) < EMAIL_CODE_ATTEMPTS &&
  hashKeptFor(code.value) === codeHashOf(sealedCode);

export const linkSeen = (
  read: LinkRead | undefined,
  contents: Opened | undefined,
  bound: boolean,
): SeenLink => {
  if (read === undefined || !read.linkLive || contents === undefined) return DEAD_LINK;
  if (!codeLive(read.code, contents.code)) return DEAD_LINK;
  if (!bound) return { state: "elsewhere", code: contents.code, until: read.code.expiresAt };
  const carried = carriedQueryOf(contents);
  return {
    state: "bound",
    address: read.address,
    carried,
    use: { email: read.address, code: contents.code, oauthQuery: contents.carried, carried },
  };
};
