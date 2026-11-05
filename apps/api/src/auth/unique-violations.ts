import type { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { DatabaseError } from "pg";

type AdapterFactory = ReturnType<typeof drizzleAdapter>;

const UNIQUE_VIOLATION = "23505";

/**
 * The oauth-provider plugin skips a concurrent insert only on a unique-violation error. Patched
 * in place because Better Auth keys a schema check on the adapter.
 */
export const surfacingUniqueViolations =
  (factory: AdapterFactory): AdapterFactory =>
  (options) => {
    const adapter = factory(options);
    const { create } = adapter;
    adapter.create = async (data) => {
      try {
        return await create(data);
      } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        throw cause instanceof DatabaseError && cause.code === UNIQUE_VIOLATION ? cause : error;
      }
    };
    return adapter;
  };
