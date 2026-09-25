import type { Logger } from "pino";

import { attempt } from "@better-answers/core/kernel";

const PING_TIMEOUT_MS = 10_000;

export type PingFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PingOutcome = "ok" | "fail";

type DeadManPing = (outcome: PingOutcome, sizes?: string) => Promise<void>;

type DeadManPingDependencies = {
  readonly check: "scheduler" | "sweeps";
  readonly url: string | undefined;
  readonly logger: Logger;

  readonly fetch?: PingFetch | undefined;
};

/**
 * The URL is the check's only credential: whoever holds it can ping over a silence, so no line
 * names it.
 */
export const deadManPing = ({
  check,
  url,
  logger,
  fetch: send = fetch,
}: DeadManPingDependencies): DeadManPing => {
  return async (outcome, sizes) => {
    if (url === undefined) return;
    const answered = await attempt(async () => {
      const response = await send(outcome === "ok" ? url : `${url}/fail`, {
        method: "POST",
        body: sizes === undefined ? outcome : `${outcome} ${sizes}`,
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      // An unread body holds its connection until a collection frees it, and a ping recurs.
      await response.body?.cancel();
      return response;
    });
    if (!answered.ok) {
      logger.warn({ check, reason: answered.error.message }, "a dead-man ping could not be sent");
    } else if (!answered.value.ok) {
      logger.warn({ check, status: answered.value.status }, "a dead-man ping was refused");
    }
  };
};
