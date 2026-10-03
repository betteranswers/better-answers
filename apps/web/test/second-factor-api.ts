import { vi } from "vitest";

import { createAppClients } from "@/app/providers.tsx";

import { appAt, openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

/** What a route asks a device to sign, for any passkey the person holds. */
export const A_CHALLENGE = { challenge: "Y2hhbGxlbmdl", userVerification: "required" };

const aByte = (): ArrayBuffer => new Uint8Array([1]).buffer;

/** A device's answer to a challenge, in the shape the browser hands it over. */
export const A_CREDENTIAL = {
  id: "a2V5",
  rawId: aByte(),
  type: "public-key",
  response: {
    authenticatorData: aByte(),
    clientDataJSON: aByte(),
    signature: aByte(),
    userHandle: null,
  },
  getClientExtensionResults: () => ({}),
  authenticatorAttachment: "platform",
};

/** A browser that can use a passkey, whose device answers every ask with one. */
export const withPasskeysHere = (): void => {
  vi.stubGlobal("PublicKeyCredential", () => undefined);
  Object.defineProperty(navigator, "credentials", {
    value: {
      get: () => Promise.resolve(A_CREDENTIAL),
      create: () => Promise.resolve(A_CREDENTIAL),
    },
    configurable: true,
  });
};

export const MADE_AT = "2026-10-02T09:41:00.000Z";

export const CODES = [
  "abcd-efgh-jkmn-pqrs",
  "tvwx-yz01-2345-6789",
  "a1b2-c3d4-e5f6-g7h8",
  "j9k0-m1n2-p3q4-r5s6",
  "t7v8-w9x0-y1z2-a3b4",
  "c5d6-e7f8-g9h0-j1k2",
  "m3n4-p5q6-r7s8-t9v0",
  "w1x2-y3z4-a5b6-c7d8",
  "e9f0-g1h2-j3k4-m5n6",
  "p7q8-r9s0-t1v2-w3x4",
];

const ADAS_SESSION = {
  session: { id: "s" },
  user: { id: "p", name: "Ada", email: "ada@example.test" },
};

/** An Admin with no passkey, no authenticator and no codes, on a session not yet confirmed. */
export const NOTHING_HELD = {
  mustHoldOne: true,
  passkeys: [],
  authenticator: "none",
  codesAcknowledged: true,
  passkeyOfferDismissed: false,
  restoreRequired: false,
  waits: { authenticator: 0, "recovery-code": 0, "restore-code": 0 },
  thisSession: { confirmed: false, setupGranted: false },
};

export const BOTH_HELD = {
  ...NOTHING_HELD,
  passkeys: [
    {
      id: "01K6AAAAAAAAAAAAAAAAAAAAAA",
      name: "MacBook",
      createdAt: "2026-03-03T10:00:00.000Z",
      lastUsedAt: null,
    },
  ],
  authenticator: "set-up",
  recoveryCodes: { unused: 9, madeAt: MADE_AT },
};

export type Route = () => Promise<Response>;

export const answering =
  (body: unknown): Route =>
  () =>
    answered(body);

export const refusing =
  (status: number, error: string, retryAfterSeconds?: number): Route =>
  () =>
    Promise.resolve(
      Response.json(
        { error },
        {
          status,
          headers:
            retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
        },
      ),
    );

/** A refusal is never asked again, so a read nothing here answers fails once and stays failed. */
const REFUSED = {
  error: {
    message: "forbidden",
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: "forbidden", class: "forbidden" },
    },
  },
};

type Procedures = ReadonlyMap<string, () => unknown>;

const answerTo = (name: string, held: () => unknown, procedures: Procedures): unknown => {
  if (name === "person.secondFactor") return { result: { data: held() } };
  const procedure = procedures.get(name);
  return procedure === undefined ? REFUSED : { result: { data: procedure() } };
};

/** `held` answers each read of Ada's second factor, `routes` each post to our own routes. */
export const adasApi = (
  held: () => unknown,
  routes: ReadonlyMap<string, Route> = new Map(),
  procedures: Procedures = new Map(),
): readonly string[] => {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const { pathname } = addressOf(input);
    asked.push(pathname);
    if (!pathname.startsWith("/trpc/")) return routes.get(pathname)?.() ?? answered(ADAS_SESSION);
    const names = pathname.replace("/trpc/", "").split(",");
    return answered(names.map((name) => answerTo(name, held, procedures)));
  });
  return asked;
};

/** Ada's session stands, and no read of the api ever answers. */
export const readingForever = (): void => {
  vi.stubGlobal("fetch", (input: string | URL | Request) =>
    addressOf(input).pathname.startsWith("/trpc/")
      ? new Promise<never>(() => undefined)
      : answered(ADAS_SESSION),
  );
};

/** The screens read their query off the address bar; the auth library's own read fails here at once. */
const clientsAt = (path: string) => {
  globalThis.history.replaceState(null, "", path);
  const clients = createAppClients();
  clients.queryClient.setDefaultOptions({ queries: { retry: false } });
  clients.queryClient.setQueryData(["auth", "session"], ADAS_SESSION);
  return clients;
};

export const openAsAda = (path: string) => openApp(path, clientsAt(path));

/** The router alone, loaded at `path` and never drawn. */
export const loadedAsAda = (path: string) => appAt(path, clientsAt(path));

/** The words in every alert that says something, in document order. */
export const alertsSaying = (): readonly string[] =>
  [...document.querySelectorAll('[role="alert"]')]
    .map((alert) => alert.textContent)
    .filter((words) => words !== "");
