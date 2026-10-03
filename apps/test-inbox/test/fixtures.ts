import { vi } from "vitest";

import worker from "../src/index.ts";
import type { Received } from "../src/store.ts";
import type { D1StandIn } from "./d1.ts";

export const NOW_MS = 1_791_000_000_000;

export const DAY_MS = 86_400_000;

export const PERSON = "admin@journeys.example";

export const PRODUCTION = "Better Answers <sign-in@better-answers.example>";

/** As long as the shortest token the Worker accepts. */
export const TOKEN = "0123456789abcdef0123456789abcdef";

export const receivedAt = (receivedAtMs: number): Received => ({
  receivedAtMs,
  recipient: PERSON,
  from: PRODUCTION,
  subject: `Sent at ${String(receivedAtMs)}`,
  raw: new TextEncoder().encode(`Subject: Sent at ${String(receivedAtMs)}\r\n\r\nYour code\r\n`),
});

/** `null` leaves the header out, or the secret unset. */
type Asked = {
  readonly method?: string;
  readonly authorization?: string | null;
  readonly token?: string | null;
};

/** A request to the Worker's fetch handler, carrying the token unless `how` says otherwise. */
export const asked = (d1: D1StandIn, path: string, how: Asked = {}): Promise<Response> => {
  const authorization = how.authorization === undefined ? `Bearer ${TOKEN}` : how.authorization;
  const token = how.token === undefined ? TOKEN : how.token;
  return worker.fetch(
    new Request(`https://test-inbox.example${path}`, {
      method: how.method ?? "GET",
      headers: authorization === null ? {} : { authorization },
    }),
    token === null ? { DB: d1.database } : { DB: d1.database, READ_TOKEN: token },
  );
};

type Emailed = {
  readonly to?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly raw?: Uint8Array;
  readonly rawSize?: number;
  readonly stream?: ReadableStream<Uint8Array>;
};

/** Cloudflare's message, its envelope sender the bounce address a sending service uses. */
export const emailOf = (emailed: Emailed = {}) => {
  const raw = emailed.raw ?? new TextEncoder().encode("Subject: Sign in\r\n\r\n482913\r\n");
  return {
    from: "bounce@send.better-answers.example",
    to: emailed.to ?? PERSON,
    headers: new Headers(emailed.headers ?? { from: PRODUCTION, subject: "Sign in" }),
    raw: emailed.stream ?? new Blob([raw]).stream(),
    rawSize: emailed.rawSize ?? raw.byteLength,
    canBeForwarded: true,
    setReject: vi.fn<(reason: string) => void>(),
    forward: vi.fn<(rcptTo: string) => Promise<void>>(),
    reply: vi.fn<(message: unknown) => Promise<void>>(),
  };
};
