import type { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { DatabaseError } from "pg";

type AdapterFactory = ReturnType<typeof drizzleAdapter>;

const UNIQUE_VIOLATION = "23505";

/**
 * The oauth-provider plugin skips a concurrent insert only when the message names a unique
 * violation. In place: Better Auth keys its schema check on it.
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
        // Drizzle wraps the driver's error, keeping the store's own on `cause`.
        const cause = error instanceof Error ? error.cause : undefined;
        throw cause instanceof DatabaseError && cause.code === UNIQUE_VIOLATION ? cause : error;
      }
    };
    return adapter;
  };
