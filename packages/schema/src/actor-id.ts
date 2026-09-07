import { ULID_CHARACTERS } from "./ulid.ts";

/**
 * The **actor id**'s one shape (ADR 0035, ADR 0019), written once as a source string so a
 * boundary refinement and a database CHECK can hold a column to the same characters.
 *
 * Three forms and no fourth: a person by their person id — the minter's shape, so an email
 * cannot pass for one — the platform by `process:better-answers-<purpose>`, and an agent by
 * `better-answers-<purpose>/<version>`, so *verifier ≠ generator* is visible on the string.
 *
 * The characters are the intersection of what JavaScript's `RegExp` and Postgres's POSIX
 * regular expressions read the same way, so the two never disagree about a row.
 */
export const ACTOR_ID_PATTERN = `(human:${ULID_CHARACTERS}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)`;

/** The compiled pattern, anchored — what a boundary refinement narrows an actor column to. */
export const ACTOR_ID = new RegExp(`^${ACTOR_ID_PATTERN}$`);

/**
 * The prefix an actor id carries when the platform is acting **as itself** — a process it
 * runs, never a person and never an agent's output. A row that may only be written by the
 * platform is held to this at the database, which is the one place a compromised producer
 * cannot argue with.
 */
export const PLATFORM_ACTOR_PREFIX = "process:better-answers-";
