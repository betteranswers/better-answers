import { z } from "zod";

import { err, ok, type Result } from "@better-answers/contracts";

/**
 * The bootstrap credential class, and the only place in the tier that reads the
 * environment (`[SEC1]`, `CODING_RULES.md` § TYPES). Every tenant credential is a
 * row under the envelope and arrives through the credentials provider instead.
 */
const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
  readonly nodeEnv: "development" | "test" | "production";
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
    nodeEnv: parsed.data.NODE_ENV,
  });
}
