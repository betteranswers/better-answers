const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ULID_CHARACTERS = "[0-9A-HJKMNP-TV-Z]{26}";
export const ULID_PATTERN = `^${ULID_CHARACTERS}$`;

export const ULID = new RegExp(ULID_PATTERN);

const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

const MAX_TIME_MS = 2 ** 48 - 1;

let lastTimeMs = -1;

const lastRandom = new Uint8Array(RANDOM_CHARS);

const drawRandom = (): void => {
  crypto.getRandomValues(lastRandom);

  for (let index = 0; index < RANDOM_CHARS; index += 1) {
    lastRandom[index] = (lastRandom[index] ?? 0) & 0b11111;
  }
};

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

const encodeTime = (milliseconds: number): string => {
  let remaining = milliseconds;
  let encoded = "";
  for (let index = 0; index < TIME_CHARS; index += 1) {
    encoded = `${ALPHABET[remaining % 32] ?? "0"}${encoded}`;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
};

export const ulid = (): string => {
  const now = Date.now();
  if (now > lastTimeMs) {
    lastTimeMs = now;
    drawRandom();
  } else if (!incrementRandom()) {
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
