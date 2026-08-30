import { z } from "zod";

import { err, ok, type Result } from "@better-answers/contracts";

import { logger } from "./logger.ts";

/**
 * The bootstrap credential class, and the only place in the tier that reads the
 * environment (`[SEC1]`, `CODING_RULES.md` § TYPES).
 *
 * The bootstrap class is what the deploy unit must give the process before it can
 * reach anything. Every other credential class — ingestion, acting, agent, LLM
 * provider, repository, object store — is a row under the envelope and never an
 * environment variable, so a key belongs here only once something in this tier reads
 * it.
 */
const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
};

export function readBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<Bootstrap> {
  const parsed = bootstrapSchema.safeParse(environment);
  if (!parsed.success) {
    return err(new Error(`bootstrap configuration is invalid:\n${z.prettifyError(parsed.error)}`));
  }

  return ok({
    databaseUrl: parsed.data.DATABASE_URL,
    port: parsed.data.PORT,
  });
}

/**
 * For entry points only — `main.ts`, `migrate.ts` and the `pnpm ops` commands B4 adds.
 * A process that cannot read its own configuration says why on the way out rather than
 * failing later against a store it was never told about.
 */
export function requireBootstrap(processName: string): Bootstrap {
  const bootstrap = readBootstrap();
  if (!bootstrap.ok) {
    logger.error({ reason: bootstrap.error.message }, `${processName} cannot start`);
    process.exit(1);
  }

  return bootstrap.value;
}
