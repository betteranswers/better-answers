import { fileURLToPath } from "node:url";

import { z } from "zod";

import { err, ok, type Result } from "@better-answers/core/kernel";
import type { ObjectStoreSettings } from "@better-answers/core/store/objects";
import type { UploadSweepMode } from "@better-answers/core/sweeps";
import { UPLOAD_SWEEP_MODES } from "@better-answers/schema";

import {
  bareHostname,
  hostIsAsWritten,
  hostnameOfUrl,
  originOfUrl,
  type PublicHostnames,
} from "./ingress/hostnames.ts";
import { logger } from "./logger.ts";

const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  WEB_ROOT: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL("../../web/dist", import.meta.url))),

  GIT_STORE_DIR: z.string().min(1).optional(),
});

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
    hostIsAsWritten,
    "PUBLIC_URL must already be written the way a URL parser reads a host: a spelling the parser rewrites (`127.000.000.001`, `0x7f.1`, a percent-encoded label) would derive an `app.` hostname no arriving request can match",
  )
  .refine(
    (value) => bareHostname.safeParse(hostnameOfUrl(value)).success,
    "PUBLIC_URL's host must be a bare hostname — DNS labels only — because it is the `app.` hostname the fence matches an arriving `Host` against",
  )

  .transform((value) => originOfUrl(value));

const identityBootstrapSchema = z
  .object({
    PUBLIC_URL: httpsOrigin,

    AUTH_SECRET: z.string().min(32),

    AGENT_HOSTNAME: bareHostname,
    APEX_HOSTNAME: bareHostname,

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

const objectStoreSchema = z.object({
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

// fetch refuses a URL with credentials in an error that quotes it whole, and that error is logged.
const deadManPingUrl = z
  .url({ protocol: /^https?$/, abort: true })
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "a check's URL must carry no credentials")
  .optional();

const sweepsSchema = z.object({
  UPLOAD_SWEEP: z.enum(UPLOAD_SWEEP_MODES).default("list"),
  HEALTHCHECKS_PING_URL_SWEEPS: deadManPingUrl,
});

const headCheckSchema = z.object({
  HEALTHCHECKS_PING_URL_SCHEDULER: deadManPingUrl,
});

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
  readonly webRoot: string;

  readonly gitStoreDir: string | undefined;
};

export type IdentityBootstrap = {
  readonly publicUrl: string;
  readonly authSecret: string;
  readonly hostnames: PublicHostnames;

  readonly smtpUrl: string | undefined;
};

export type SweepSettings = {
  readonly uploadSweep: UploadSweepMode;

  readonly pingUrl: string | undefined;
};

export type HeadCheckSettings = {
  readonly pingUrl: string | undefined;
};

const invalid = (parsed: z.ZodError, what = "bootstrap configuration"): Error =>
  new Error(`${what} is invalid:\n${z.prettifyError(parsed)}`);

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
      app: hostnameOfUrl(parsed.data.PUBLIC_URL),
      agent: parsed.data.AGENT_HOSTNAME,
      apex: parsed.data.APEX_HOSTNAME,
    },
  });
}

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

export function readSweeps(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<SweepSettings> {
  const parsed = sweepsSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the sweeps' settings"));
  return ok({
    uploadSweep: parsed.data.UPLOAD_SWEEP,
    pingUrl: parsed.data.HEALTHCHECKS_PING_URL_SWEEPS,
  });
}

export function readHeadCheck(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<HeadCheckSettings> {
  const parsed = headCheckSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the head check's settings"));
  return ok({ pingUrl: parsed.data.HEALTHCHECKS_PING_URL_SCHEDULER });
}

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
