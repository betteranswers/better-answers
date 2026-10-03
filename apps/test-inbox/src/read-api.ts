import type {
  TestInboxListed,
  TestInboxMessage,
  TestInboxPage,
} from "@better-answers/schema/test-inbox";

import type { Kept, Store } from "./store.ts";

export type Logged = (event: string, detail: Readonly<Record<string, string | number>>) => void;

type ReadApi = {
  readonly store: Store;
  /** Undefined while the secret is unset or too short to trust. */
  readonly token: string | undefined;
  readonly nowMs: number;
  readonly logged: Logged;
};

const RECEIVING = "/emails/receiving";

const ONE_MESSAGE = /^\/emails\/receiving\/([^/]+)$/;

const PROBE_PATH = "/probe";

const LIMIT_MOST = 100;

const BEARER = /^Bearer (\S+)$/i;

/** Under the engine's limit on a call's arguments, which `fromCharCode` spreads its bytes into. */
const BASE64_CHUNK_BYTES = 0x8000;

type Body =
  | TestInboxPage
  | TestInboxMessage
  | { readonly name: string }
  | { readonly probed: true };

const answered = (
  status: number,
  body: Body,
  headers: Readonly<Record<string, string>> = {},
): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

const refused = (status: number, name: string): Response => answered(status, { name });

const unavailable = (api: ReadApi, error: string): Response => {
  api.logged("store-unavailable", { error });
  return refused(503, "store_unavailable");
};

const digestOf = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** Compares digests, so a token of any length takes the same time and reveals nothing of it. */
const admits = async (authorization: string | null, token: string): Promise<boolean> => {
  const offered = BEARER.exec(authorization ?? "")?.[1];
  if (offered === undefined) return false;
  const [given, expected] = await Promise.all([digestOf(offered), digestOf(token)]);
  const difference = given.reduce((folded, byte, at) => folded | (byte ^ (expected[at] ?? 0)), 0);
  return difference === 0;
};

const limitOf = (given: string | null): number => {
  const asked = Math.trunc(Number(given));
  if (given === null || given === "" || Number.isNaN(asked)) return LIMIT_MOST;
  return Math.min(Math.max(asked, 1), LIMIT_MOST);
};

const listedOf = (kept: Kept): TestInboxListed => ({
  id: kept.id,
  to: [kept.recipient],
  from: kept.from,
  created_at: new Date(kept.receivedAtMs).toISOString(),
  subject: kept.subject,
});

const base64Of = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK_BYTES) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK_BYTES)));
  }
  return btoa(chunks.join(""));
};

const listed = async (api: ReadApi, url: URL): Promise<Response> => {
  const page = await api.store.page({
    after: url.searchParams.get("after") ?? undefined,
    limit: limitOf(url.searchParams.get("limit")),
  });
  if (!page.ok) return unavailable(api, page.error);
  const body: TestInboxPage = {
    object: "list",
    has_more: page.value.hasMore,
    data: page.value.messages.map(listedOf),
  };
  return answered(200, body);
};

const retrieved = async (api: ReadApi, id: string): Promise<Response> => {
  const message = await api.store.message(id);
  if (!message.ok) return unavailable(api, message.error);
  if (message.value === undefined) return refused(404, "not_found");
  const body: TestInboxMessage = { ...listedOf(message.value), raw: base64Of(message.value.raw) };
  return answered(200, body);
};

const probed = async (api: ReadApi): Promise<Response> => {
  const probe = await api.store.probe(api.nowMs);
  return probe.ok ? answered(200, { probed: true }) : unavailable(api, probe.error);
};

type Route = {
  readonly allowed: "GET" | "POST";
  readonly answer: (api: ReadApi, url: URL) => Promise<Response>;
};

/** Matches the id as the path carries it, so a malformed escape is an unknown id, not a throw. */
const routeOf = (pathname: string): Route | undefined => {
  if (pathname === RECEIVING) return { allowed: "GET", answer: listed };
  if (pathname === PROBE_PATH) return { allowed: "POST", answer: probed };
  const id = ONE_MESSAGE.exec(pathname)?.[1];
  return id === undefined ? undefined : { allowed: "GET", answer: (api) => retrieved(api, id) };
};

/** Answers JSON on every path, never a redirect or a page, and reads nothing for a refused one. */
export const answer = async (request: Request, api: ReadApi): Promise<Response> => {
  if (api.token === undefined) return refused(503, "not_configured");
  if (!(await admits(request.headers.get("authorization"), api.token))) {
    return refused(401, "unauthorized");
  }
  const url = new URL(request.url);
  const route = routeOf(url.pathname);
  if (route === undefined) return refused(404, "not_found");
  if (request.method !== route.allowed) {
    return answered(405, { name: "method_not_allowed" }, { allow: route.allowed });
  }
  return route.answer(api, url);
};
