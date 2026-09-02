import { z } from "zod";

import { err, ok, type Result } from "@better-answers/core/kernel";

import { bareHostname, hostnameOfUrl, type PublicHostnames } from "./ingress/hostnames.ts";
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
 * `app` also needs the authorization server's origin and secret (ADR 0009).
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
    return (
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  }, "PUBLIC_URL must be an https origin with no path, query, fragment or credentials")
  .transform((value) => new URL(value).origin);

const identityBootstrapSchema = z
  .object({
    // The https origin the authorization server issues from and the MCP URL hangs off
    // (`mcp.` in the estate, ADR 0022). Everything spec-exact — issuer, PRM `resource`,
    // audience — is derived from it, so it is bootstrap, not a row.
    PUBLIC_URL: httpsOrigin,
    // Better Auth's secret: signs the OAuth flow's state and encrypts the JWKS private
    // keys at rest (ADR 0009).
    AUTH_SECRET: z.string().min(32),
    // The estate's four hostnames (ADR 0022), read here because the hostname fence
    // (`ingress/hostnames.ts`) has to know them before the first request: a hostname
    // the deploy unit did not give the process is a hostname that reaches nothing, so
    // a missing or malformed one stops the process rather than opening it.
    APP_HOSTNAME: bareHostname,
    MCP_HOSTNAME: bareHostname,
    AGENT_HOSTNAME: bareHostname,
    APEX_HOSTNAME: bareHostname,
  })
  .refine(
    // Read through the fence's own reading of a URL's host, so "the same host" means
    // one thing on both sides: a `PUBLIC_URL` carrying DNS's trailing root dot names
    // the same host as the bare `MCP_HOSTNAME` and must not stop the process.
    (parsed) => parsed.MCP_HOSTNAME === hostnameOfUrl(parsed.PUBLIC_URL),
    "MCP_HOSTNAME must be PUBLIC_URL's host: they are one origin (ADR 0022), and discovery, the token audience and the protected-resource document are all derived from PUBLIC_URL",
  )
  .refine((parsed) => {
    const hostnames = [
      parsed.APP_HOSTNAME,
      parsed.MCP_HOSTNAME,
      parsed.AGENT_HOSTNAME,
      parsed.APEX_HOSTNAME,
    ];
    return new Set(hostnames).size === hostnames.length;
  }, "the four hostnames must differ: two the same hands one hostname's surface to the other, which is the fence this configuration exists to raise");

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
};

export type IdentityBootstrap = {
  readonly publicUrl: string;
  readonly authSecret: string;
  readonly hostnames: PublicHostnames;
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
  return ok({
    publicUrl: parsed.data.PUBLIC_URL,
    authSecret: parsed.data.AUTH_SECRET,
    hostnames: {
      app: parsed.data.APP_HOSTNAME,
      mcp: parsed.data.MCP_HOSTNAME,
      agent: parsed.data.AGENT_HOSTNAME,
      apex: parsed.data.APEX_HOSTNAME,
    },
  });
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
