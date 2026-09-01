import { z } from "zod";

import { err, ok, type Result } from "@better-answers/core/kernel";

import { logger } from "./logger.ts";

/**
 * The bootstrap credential class, and the only place in the tier that reads the
 * environment (`[SEC1]`, `CODING_RULES.md` § TYPES).
 *
 * The bootstrap class is what the deploy unit must give the process before it can
 * reach anything. Every other credential class — ingestion, acting, agent, LLM
 * provider, repository, object store — is a row under the envelope and never an
 * environment variable, so a key belongs here only once something in this tier reads
 * it. Two shapes, because two processes read it: `migrate` needs the database alone,
 * `app` also needs the identity provider's origin and secret.
 */
const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

/** An https origin and nothing else: no path, query or fragment, so every URL derived from it agrees with the root-mounted routes. */
const httpsOrigin = z
  .url({ protocol: /^https$/ })
  .refine((value) => {
    const url = new URL(value);
    return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
  }, "PUBLIC_URL must be an https origin with no path, query or fragment")
  .transform((value) => new URL(value).origin);

const identityBootstrapSchema = z.object({
  // The https origin the authorization server issues from and the MCP URL hangs off
  // (`mcp.` in the estate, ADR 0022). Everything spec-exact — issuer, PRM `resource`,
  // audience — is derived from it, so it is bootstrap, not a row.
  PUBLIC_URL: httpsOrigin,
  // Better Auth's secret: signs the OAuth flow's state and encrypts the JWKS private
  // keys at rest (ADR 0009).
  AUTH_SECRET: z.string().min(32),
});

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
};

export type IdentityBootstrap = {
  readonly publicUrl: string;
  readonly authSecret: string;
};

const invalid = (parsed: z.ZodError): Error =>
  new Error(`bootstrap configuration is invalid:\n${z.prettifyError(parsed)}`);

export function readBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<Bootstrap> {
  const parsed = bootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({ databaseUrl: parsed.data.DATABASE_URL, port: parsed.data.PORT });
}

export function readIdentityBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<IdentityBootstrap> {
  const parsed = identityBootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({ publicUrl: parsed.data.PUBLIC_URL, authSecret: parsed.data.AUTH_SECRET });
}

/**
 * For entry points only — `main.ts`, `migrate.ts` and the `pnpm ops` commands B4 adds.
 * A process that cannot read its own configuration says why on the way out rather than
 * failing later against a store it was never told about.
 */
export function requireBootstrap(processName: string): Bootstrap {
  return orExit(processName, readBootstrap());
}

export function requireIdentityBootstrap(processName: string): IdentityBootstrap {
  return orExit(processName, readIdentityBootstrap());
}

const orExit = <T>(processName: string, read: Result<T>): T => {
  if (!read.ok) {
    logger.error({ reason: read.error.message }, `${processName} cannot start`);
    process.exit(1);
  }
  return read.value;
};
