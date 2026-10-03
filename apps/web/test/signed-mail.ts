import { generateKeyPairSync } from "node:crypto";

import type { DNSResolver } from "mailauth";
import { dkimSign } from "mailauth/lib/dkim/sign.js";

/** Production's sender sits on the product's apex, and its mail is signed as that apex. */
const SENDER_DOMAIN = "better-answers.example";
export const PRODUCTION = `no-reply@${SENDER_DOMAIN}`;
export const PERSON = "admin@journeys.example";

type Signer = {
  readonly domain: string;
  readonly selector: string;
  readonly privateKey: string;
  /** The TXT record that publishes the key's public half. */
  readonly record: string;
};

const signerFor = (domain: string): Signer => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    domain,
    selector: "resend",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    record: `v=DKIM1; k=rsa; p=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`,
  };
};

const THE_SENDER = signerFor(SENDER_DOMAIN);

/** Production's mail carries a second signature, from the service that relays it. */
export const THE_RELAY = signerFor("amazonses.example");

export const A_FORGER = signerFor("forger.example");

/** Signs as the sender's domain and selector with a key that DNS does not publish. */
export const AN_UNPUBLISHED_KEY = signerFor(SENDER_DOMAIN);

const PUBLISHED = new Map(
  [THE_SENDER, THE_RELAY, A_FORGER].map(({ domain, selector, record }) => [
    `${selector}._domainkey.${domain}`,
    record,
  ]),
);

/** The test's DNS: each published key's record, and no record for any other name. */
export const publishedKeys: DNSResolver = async (name) => {
  const record = PUBLISHED.get(name);
  if (record === undefined) throw Object.assign(new Error("no such record"), { code: "ENOTFOUND" });
  return [[record]];
};

/** The production sign-in email's text part, link first and the code alone on a later line. */
export const signInText = (code: string): string =>
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
  ].join("\r\n");

type Composed = {
  readonly to?: string;
  readonly messageId?: string;
  readonly contentType?: string;
  readonly transferEncoding?: string;
  /** The body as it travels, already in its transfer encoding. */
  readonly body: string;
};

let composedSoFar = 0;

/** An RFC 5322 message with the headers production's sign-in email carries. */
export const composed = (mail: Composed): string => {
  composedSoFar += 1;
  return [
    `From: Better Answers <${PRODUCTION}>`,
    `To: ${mail.to ?? PERSON}`,
    "Subject: Sign in to Better Answers",
    `Message-ID: <${mail.messageId ?? `sign-in-${String(composedSoFar)}`}@${SENDER_DOMAIN}>`,
    "Date: Fri, 02 Oct 2026 02:35:14 +0000",
    "MIME-Version: 1.0",
    `Content-Type: ${mail.contentType ?? "text/plain; charset=utf-8"}`,
    `Content-Transfer-Encoding: ${mail.transferEncoding ?? "7bit"}`,
    "",
    mail.body,
  ].join("\r\n");
};

/** The headers production's relay signs, as the deployed inbox received them. */
const SIGNED_HEADERS = "From:To:Subject:Message-ID:Date:MIME-Version:Content-Type";

type Signing = {
  readonly by?: readonly Signer[];
  readonly headers?: string;
  /** Signs this many body bytes alone, which `l=` declares. */
  readonly bodyBytes?: number;
};

/** The message with a DKIM-Signature from each signer prepended, as a relay would. */
export const signed = async (message: string, signing: Signing = {}): Promise<string> => {
  const signatureData = (signing.by ?? [THE_SENDER]).map((signer) => ({
    signingDomain: signer.domain,
    selector: signer.selector,
    privateKey: signer.privateKey,
    ...(signing.bodyBytes === undefined ? {} : { maxBodyLength: signing.bodyBytes }),
  }));
  const [first] = signatureData;
  if (first === undefined) return message;
  const { signatures, errors } = await dkimSign(message, {
    ...first,
    headerList: signing.headers ?? SIGNED_HEADERS,
    signatureData,
  });
  if (errors.length > 0) throw new Error("a fixture message could not be signed");
  return `${signatures}${message}`;
};

/** A sign-in email as production sends it, signed by its sender and its relay. */
export const genuine = (code: string, mail: Partial<Composed> = {}): Promise<string> =>
  signed(composed({ body: signInText(code), ...mail }), { by: [THE_SENDER, THE_RELAY] });
