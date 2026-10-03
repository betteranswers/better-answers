import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type RequestListener } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  TestInboxListed,
  TestInboxMessage,
  TestInboxPage,
} from "@better-answers/schema/test-inbox";

/** One message as the test inbox keeps it. */
export type Stored = {
  readonly id: string;
  /** The envelope's recipients. */
  readonly to: readonly string[];
  /** The header `From`, as sent. */
  readonly from: string;
  /** As a retrieve answers it: base64, unless a test breaks it. */
  readonly raw: string;
  /** Listed, but gone by the time it is retrieved, as an expired message is. */
  readonly vanished?: boolean;
};

export type Answer = {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
};

type Heard = {
  readonly method: string;
  readonly url: URL;
  readonly authorization: string | undefined;
  readonly userAgent: string | undefined;
};

export type StandIn = {
  readonly origin: string;
  readonly heard: readonly Heard[];
  /** Listed by id, so a test mints its ids in the order its messages arrive. */
  readonly arrive: (...arriving: readonly Stored[]) => void;
  readonly answerEverythingWith: (answer: Answer) => void;
  readonly probeAnswers: (answer: Answer) => void;
  readonly close: () => Promise<void>;
};

export type Tls = { readonly key: string; readonly cert: string; readonly certFile: string };

const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });

const PROBED = json(200, { probed: true });
export const STORE_UNAVAILABLE = json(503, { name: "store_unavailable" });
const UNAUTHORIZED = json(401, { name: "unauthorized" });
const NOT_FOUND = json(404, { name: "not_found" });

const listedOf = (one: Stored): TestInboxListed => ({
  id: one.id,
  to: [...one.to],
  from: one.from,
  created_at: "2026-10-02T02:35:14.000Z",
  subject: "Sign in to Better Answers",
});

const LIMIT_MOST = 100;

/** As the Worker reads it: a missing or unreadable `limit` is the most a page holds. */
const limitOf = (given: string | null): number => {
  const asked = given === null || given === "" ? Number.NaN : Math.trunc(Number(given));
  return Number.isNaN(asked) ? LIMIT_MOST : Math.min(LIMIT_MOST, Math.max(1, asked));
};

const newestFirst = (one: Stored, other: Stored): number =>
  Number(other.id > one.id) - Number(other.id < one.id);

/**
 * The Worker's cursor rule: ids sort as arrivals do, so a page continues below `after` even once
 * that message is gone.
 */
const pageOf = (inbox: readonly Stored[], query: URLSearchParams): TestInboxPage => {
  const after = query.get("after");
  const below = inbox.filter(({ id }) => after === null || id < after).toSorted(newestFirst);
  const limit = limitOf(query.get("limit"));
  return {
    object: "list",
    has_more: below.length > limit,
    data: below.slice(0, limit).map(listedOf),
  };
};

const retrieved = (one: Stored): TestInboxMessage => ({ ...listedOf(one), raw: one.raw });

type Held = { readonly key: string; readonly inbox: readonly Stored[]; readonly probe: Answer };

const answerTo = (held: Held, heard: Heard): Answer => {
  if (heard.authorization !== `Bearer ${held.key}`) return UNAUTHORIZED;
  if (heard.method === "POST" && heard.url.pathname === "/probe") return held.probe;
  if (heard.url.pathname === "/emails/receiving") {
    return json(200, pageOf(held.inbox, heard.url.searchParams));
  }
  const id = /^\/emails\/receiving\/([^/]+)$/.exec(heard.url.pathname)?.[1];
  const found = held.inbox.find((one) => one.id === id);
  return found === undefined || found.vanished === true ? NOT_FOUND : json(200, retrieved(found));
};

type Opening = {
  /** The bearer token the stand-in admits. */
  readonly key: string;
  readonly before?: readonly Stored[];
  /** Served over https with this certificate when given. */
  readonly tls?: Tls;
};

const closers: (() => Promise<void>)[] = [];

/** A stand-in for the test inbox's read API, listing the greatest id first as the Worker does. */
export const inboxStandIn = async ({ key, before = [], tls }: Opening): Promise<StandIn> => {
  const inbox: Stored[] = [...before];
  const heard: Heard[] = [];
  let failure: Answer | undefined;
  let probe = PROBED;
  const listener: RequestListener = (request, response) => {
    const { authorization, "user-agent": userAgent } = request.headers;
    const one: Heard = {
      method: request.method ?? "GET",
      url: new URL(request.url ?? "/", "http://stand-in"),
      authorization,
      userAgent,
    };
    heard.push(one);
    const { status, body, headers } = failure ?? answerTo({ key, inbox, probe }, one);
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(body);
  };
  const server = tls === undefined ? createHttpServer(listener) : createHttpsServer(tls, listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = (): Promise<void> => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  };
  closers.push(close);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port to listen on");
  return {
    origin: `${tls === undefined ? "http" : "https"}://127.0.0.1:${String(address.port)}`,
    heard,
    arrive: (...arriving) => inbox.push(...arriving),
    answerEverythingWith: (answer) => {
      failure = answer;
    },
    probeAnswers: (answer) => {
      probe = answer;
    },
    close,
  };
};

/** Every stand-in opened since the last call, for a suite's `afterEach`. */
export const closeEveryStandIn = (): Promise<void[]> =>
  Promise.all(closers.splice(0).map((close) => close()));

/** A throwaway certificate for 127.0.0.1, which a child process trusts by `NODE_EXTRA_CA_CERTS`. */
export const loopbackTls = (): Tls => {
  const directory = mkdtempSync(path.join(tmpdir(), "inbox-tls-"));
  const keyFile = path.join(directory, "key.pem");
  const certFile = path.join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8"), certFile };
};
