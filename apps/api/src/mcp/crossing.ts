import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import { attemptResult, type Result } from "@better-answers/core/kernel";

import { fieldsSaid, refusalLogged, refusalOf, type RefusalAnswer } from "../refusal.ts";

const asToolError = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

/**
 * An act's refusal or failure answers as a tool error. Its rejection is caught here, not by the
 * protocol, so it is logged once.
 */
export const crossing = async <Value>(
  log: Logger,
  entry: string,
  running: () => Promise<Result<Value, RefusalAnswer | Error>>,
  render: (value: Value) => string,
): Promise<CallToolResult> => {
  const answered = await attemptResult(running);

  if (answered.ok) {
    return {
      content: [{ type: "text", text: render(answered.value) }],
      structuredContent: answered.value,
    };
  }
  if (answered.error instanceof Error) {
    log.error({ event: "mcp.failed", entry, err: answered.error }, "failed");
    return asToolError(`${entry} failed.`);
  }
  const refusal = refusalOf(answered.error);
  log.info({ event: "mcp.refused", entry, ...refusalLogged(refusal) }, "refused");
  return asToolError(`Refused: ${refusal.word} (${refusal.class}).${fieldsSaid(refusal)}`);
};
