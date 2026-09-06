/**
 * The platform's one minter and the one shape every id it mints has (ADR 0035): a ULID —
 * 48 bits of milliseconds, then 80 bits of randomness, Crockford base32, 26 characters.
 * The body lives here, beside the pattern the boundary schemas refine against, because
 * `packages/schema` cannot import `packages/core`; `packages/core/src/kernel` re-exports
 * it as the platform's one minter, the same direction the kernel already takes its id
 * brands (ADR 0028, ADR 0029).
 *
 * Written here rather than taken from a package: the whole of it is the thirty lines
 * below, and a dependency would be a pinned version, a supply-chain surface and a
 * release to follow for a function whose specification is fixed.
 *
 * It mints ids, never secrets. Nothing that has to be unguessable — a session token, an
 * authorisation code, a client secret, a token's `jti` — comes from here: the time half
 * of a ULID is public by design and the randomness is 80 bits, so an id is unique and
 * sortable, not confidential.
 */

/** Crockford base32, in value order: no I, L, O or U, so no digit is misread aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The one written form of the shape, as a source string so both a `RegExp` here and the
 * tier contract's fixture can hold the same characters. Crockford's excluded letters are
 * the gaps in the range. The unanchored characters are exported on their own for the one
 * pattern that embeds an id inside a longer string — the ledger's actor, `human:<person id>`.
 */
export const ULID_CHARACTERS = "[0-9A-HJKMNP-TV-Z]{26}";
export const ULID_PATTERN = `^${ULID_CHARACTERS}$`;

/**
 * The compiled pattern, so a caller asking "is this the shape the platform mints?" reads
 * one object rather than each building its own from the string. No `g` flag, so it holds
 * no cursor between calls and is safe to share.
 */
export const ULID = new RegExp(ULID_PATTERN);

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
/** 48 bits of milliseconds is the last instant a ULID's time half can hold. */
const MAX_TIME_MS = 2 ** 48 - 1;

/**
 * The monotonic state: two ids minted in the same millisecond must still sort in the
 * order they were minted, which means the second one's random half is the first one's
 * plus one rather than a fresh draw. One process, one module, one counter — a second
 * process minting in the same millisecond gets a different random half, and the ids are
 * unordered between them, which is what a ULID promises and all it promises.
 */
let lastTimeMs = -1;
/**
 * The random half is kept as sixteen five-bit digits rather than ten bytes so that
 * adding one to it is a carry over the characters it will be written as; packing and
 * unpacking eighty bits on every mint would buy nothing.
 */
const lastRandom = new Uint8Array(RANDOM_CHARS);

const drawRandom = (): void => {
  crypto.getRandomValues(lastRandom);
  // Each byte becomes one base32 digit; the low five bits of a uniform byte are
  // themselves uniform, so masking costs no entropy the digit could have carried.
  for (let index = 0; index < RANDOM_CHARS; index += 1) {
    lastRandom[index] = (lastRandom[index] ?? 0) & 0b11111;
  }
};

/**
 * Add one to the random half, carrying left — the increment that keeps two ids minted in
 * the same millisecond in the order they were minted. Returns false when all 80 bits were
 * already set and there is nothing left to carry into.
 *
 * The `?? 0` reads a digit the array certainly has: the loop's index is bounded by the
 * array's own length. It is there because the compiler cannot see that, and a thrown
 * error would be a worse answer than a digit.
 */
const incrementRandom = (): boolean => {
  for (let index = RANDOM_CHARS - 1; index >= 0; index -= 1) {
    const digit = lastRandom[index] ?? 0;
    if (digit < 31) {
      lastRandom[index] = digit + 1;
      return true;
    }
    lastRandom[index] = 0;
  }
  return false;
};

/**
 * The milliseconds as ten base32 digits, most significant first — the half that makes an
 * id sortable and readable back as a time. The `?? "0"` is the same bounded-index
 * appeasement as above: `remaining % 32` is always an index the alphabet has.
 */
const encodeTime = (milliseconds: number): string => {
  let remaining = milliseconds;
  let encoded = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    encoded = `${ALPHABET[remaining % 32] ?? "0"}${encoded}`;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
};

/**
 * Mint one id. Every id the platform writes for itself comes from here — the first
 * Admin's membership row, the erasure pseudonym, a workspace — and Better Auth is handed
 * this same function for the rows it writes (`apps/api/src/auth/auth.ts`).
 */
export const ulid = (): string => {
  const now = Date.now();
  if (now > lastTimeMs) {
    lastTimeMs = now;
    drawRandom();
  } else if (!incrementRandom()) {
    // All 80 bits were set inside one millisecond — 2^80 ids from one process in one
    // millisecond, which no caller can reach. Borrowing the next millisecond keeps the
    // promise that matters (ids sort in minting order) instead of throwing at a caller
    // who did nothing wrong.
    lastTimeMs += 1;
    drawRandom();
  }
  if (lastTimeMs > MAX_TIME_MS) {
    throw new Error("the ULID time half holds 48 bits of milliseconds; the clock is past it");
  }

  let encoded = encodeTime(lastTimeMs);
  for (const digit of lastRandom) encoded += ALPHABET[digit] ?? "0";
  return encoded;
};
