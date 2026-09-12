import { fileURLToPath } from "node:url";

import { z } from "zod";

import { err, ok, type Result } from "@better-answers/core/kernel";
import type { ObjectStoreSettings } from "@better-answers/core/store/objects";

import {
  bareHostname,
  hostIsAsWritten,
  hostnameOfUrl,
  originOfUrl,
  type PublicHostnames,
} from "./ingress/hostnames.ts";
import { logger } from "./logger.ts";

/**
 * The bootstrap credential class, and the only place in the tier that reads the
 * environment.
 *
 * The bootstrap class is what the deploy unit must give the process before it can
 * reach anything, and `docs/operations/SECRETS.md` says what that is: the envelope key,
 * the auth secret, the database DSNs, the tunnel token, transactional email, **the
 * object store's root pair** and the dead-man ping URLs. The other credential classes —
 * ingestion, acting, agent, LLM provider, repository, and a *workspace's own* object
 * store — are a tenant's rather than the platform's: each is a row under the envelope,
 * read through a credentials provider no task has built yet, and never an environment
 * variable. Two shapes for what a process needs to start, because two processes read
 * one: `migrate` needs the database alone, `app` also needs the one public origin and
 * the authorization server's secret (ADR 0009, ADR 0034). The object store is a third
 * reading, below, for the reason given there.
 */
const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Where `apps/web`'s static build is on disk, because the app serves it on `app.`
  // (ADR 0006, amended 2026-09-02). The default is the build directory in this repository,
  // which is what `pnpm --filter @better-answers/web build` writes and what the dev loop
  // and the browser suite use; an image that lays the build down elsewhere names it.
  // `.min(1)` because an empty value is not "unset": it would reach the static handler as
  // a root of "", which resolves against the working directory and would serve the app
  // image's own files on `app.`.
  WEB_ROOT: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL("../../web/dist", import.meta.url))),
  // Where the workspaces' bare repositories are — `<root>/<workspace>.git`, written through
  // the git binary (ADR 0024; `/data/git` in the estate). Optional, because `migrate` shares
  // this shape and has no bundle to open; the app starts its periodic head check — the
  // reconciler's trigger (ADR 0012, amended 2026-09-06) — only when it is set, and says so
  // either way. `.min(1)` for `WEB_ROOT`'s reason: an empty root would open every
  // repository relative to the working directory.
  GIT_STORE_DIR: z.string().min(1).optional(),
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
  .refine(
    // The `app.` hostname is this URL's host, so a host the parser rewrites is a
    // hostname the operator never wrote and cannot find in their DNS. `bareHostname`
    // refuses that class for the two declared hostnames (T-030); the fence makes the
    // same reading of the one that is derived (T-039, T-045).
    hostIsAsWritten,
    "PUBLIC_URL must already be written the way a URL parser reads a host: a spelling the parser rewrites (`127.000.000.001`, `0x7f.1`, a percent-encoded label) would derive an `app.` hostname no arriving request can match",
  )
  .refine(
    // The derived hostname is validated exactly as the two declared ones are, so the
    // three are one class of value and not two plus an exception.
    (value) => bareHostname.safeParse(hostnameOfUrl(value)).success,
    "PUBLIC_URL's host must be a bare hostname — DNS labels only — because it is the `app.` hostname the fence matches an arriving `Host` against",
  )
  // Normalised to the bare host, not merely parsed: DNS's trailing root dot names the
  // same host, but every string this origin becomes — the issuer, the token audience,
  // the protected-resource document, Better Auth's trusted origin and the consent
  // form's `origin === publicUrl` check — is compared character for character against
  // an `Origin` a browser sends without it.
  .transform((value) => originOfUrl(value));

const identityBootstrapSchema = z
  .object({
    // The one https origin the product is served from, the authorization server issues
    // from and the MCP URL hangs off (`app.` in the estate; ADR 0034). Everything
    // spec-exact — issuer, PRM `resource`, audience — and every page of the flow is
    // derived from it, so it is bootstrap, not a row.
    PUBLIC_URL: httpsOrigin,
    // Better Auth's secret: signs the OAuth flow's state and encrypts the JWKS private
    // keys at rest (ADR 0009).
    AUTH_SECRET: z.string().min(32),
    // Two of the estate's three hostnames (ADR 0022, ADR 0034), read here because the
    // hostname fence (`ingress/hostnames.ts`) has to know them before the first request:
    // a hostname the deploy unit did not give the process is a hostname that reaches
    // nothing, so a missing or malformed one stops the process rather than opening it.
    // The third is not declared — `app.` *is* `PUBLIC_URL`'s host, and one truth in two
    // places is one more thing to get wrong on deploy day (T-039), so it is derived
    // through the fence's own reading of a host and the two sides still agree by
    // construction rather than by a refine.
    AGENT_HOSTNAME: bareHostname,
    APEX_HOSTNAME: bareHostname,
    // The sign-in email's transport, as a connection URL (`smtps://resend:<key>@...` in
    // the estate). Bootstrap rather than a row under the envelope because the first email
    // the tier sends precedes the first signed-in user — no principal exists yet to
    // install a row. Optional so the dev loop and the test harness run without a mail
    // account; the deploy unit marks it required (`${SMTP_URL:?}` in
    // `deploy/platform.compose.yaml`), and the scheme check stops the process when
    // Coolify hands the `:?` message through as the value instead of failing the parse.
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  })
  .refine((parsed) => {
    const hostnames = [
      hostnameOfUrl(parsed.PUBLIC_URL),
      parsed.AGENT_HOSTNAME,
      parsed.APEX_HOSTNAME,
    ];
    return new Set(hostnames).size === hostnames.length;
  }, "the three hostnames must differ, the derived `app.` one included: two the same hands one hostname's surface to the other, which is the fence this configuration exists to raise");

/**
 * The object store, for the two commands that reach it.
 *
 * **The pair below is bootstrap class**, which is what `docs/operations/SECRETS.md` records
 * — "the object store's root pair", in the same row as the database DSNs and the envelope
 * key — and what `deploy/platform.compose.yaml`'s `x-bootstrap` anchor hands over. It is the
 * platform's own store and not a workspace's: the bucket holds the platform's own records,
 * among them the replay copy a restore reads before `api` is allowed to turn healthy, so a
 * credential kept in a row under the envelope would be one the restore needs before there is
 * a database to read the row from.
 *
 * It is a **reading of its own** all the same, because a process that cannot reach the object
 * store must still start: `migrate`'s environment is the database alone, and `pnpm ops` runs
 * in the same image as every other command. Only `replay-erasures` and `erasure-rehearsal`
 * open this door — the replay reads the copies a dump predates, the rehearsal runs a routine
 * that writes one — and each refuses on its own behalf when the reading failed, which is the
 * answer a restore has to see rather than a process that would not come up.
 *
 * The names are the estate's, and so is the region: `deploy/garage.toml` fixes
 * `s3_region = "garage"` for the cluster and the anchor tells the app the same word, the two
 * lines held against each other by the deploy tree's own test. There is no default here,
 * because a region is a fact of the estate a process was deployed into and never a fact of
 * this tier — a third place to write one is a third place for it to disagree, and a client
 * that signs for a region the cluster does not answer to is refused rather than misrouted.
 */
const objectStoreSchema = z.object({
  // http or https and nothing else. A URL parser reads `objectstore:3900` as a URL — scheme
  // `objectstore:`, the rest opaque — so `z.url()` alone would take a host and port an
  // operator wrote without a scheme and hand it to a client that cannot speak it; the first
  // sign would be a connection error in the middle of a restore. Plain http is allowed
  // because the estate reaches Garage by service name on an internal network (ADR 0024).
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
  readonly webRoot: string;
  /** The bare repositories' root; absent, nothing in this process opens a bundle. */
  readonly gitStoreDir: string | undefined;
};

export type IdentityBootstrap = {
  /** The one origin: the product, the authorization server and the MCP surface (ADR 0034). */
  readonly publicUrl: string;
  readonly authSecret: string;
  readonly hostnames: PublicHostnames;
  /** The sign-in email's SMTP connection URL; absent, the app starts and a code request fails loudly instead of sending. */
  readonly smtpUrl: string | undefined;
};

const invalid = (parsed: z.ZodError): Error =>
  new Error(`bootstrap configuration is invalid:\n${z.prettifyError(parsed)}`);

export function readBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<Bootstrap> {
  const parsed = bootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    databaseUrl: parsed.data.DATABASE_URL,
    port: parsed.data.PORT,
    webRoot: parsed.data.WEB_ROOT,
    gitStoreDir: parsed.data.GIT_STORE_DIR,
  });
}

export function readIdentityBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<IdentityBootstrap> {
  const parsed = identityBootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    publicUrl: parsed.data.PUBLIC_URL,
    authSecret: parsed.data.AUTH_SECRET,
    smtpUrl: parsed.data.SMTP_URL,
    hostnames: {
      // Read the way the fence reads an arriving request's host, so the hostname the
      // router matches on and the origin every spec-exact string is derived from are
      // one value from one place (ADR 0022, T-039; ADR 0034).
      app: hostnameOfUrl(parsed.data.PUBLIC_URL),
      agent: parsed.data.AGENT_HOSTNAME,
      apex: parsed.data.APEX_HOSTNAME,
    },
  });
}

/**
 * The object store's settings as `openObjects` takes them, or the reason there are none.
 *
 * A refusal here is not a failure to start: the caller decides. `ops.ts` reads it once, opens
 * the door when it can and hands `undefined` on when it cannot, and the two commands that
 * want a door say so themselves.
 */
export function readObjectStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<ObjectStoreSettings> {
  const parsed = objectStoreSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    endpoint: parsed.data.S3_ENDPOINT,
    region: parsed.data.S3_REGION,
    bucket: parsed.data.S3_BUCKET,
    accessKeyId: parsed.data.S3_ACCESS_KEY,
    secretAccessKey: parsed.data.S3_SECRET_KEY,
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
