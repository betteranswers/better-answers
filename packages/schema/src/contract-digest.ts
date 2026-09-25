import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const CONTRACTS_ROOT = path.resolve(import.meta.dirname, "../../../contracts");

export const CONTRACT_STAMP_MODULE = path.resolve(import.meta.dirname, "contract-stamp.ts");

/**
 * Whole and lowercase: a short form in a log is a value somebody compares by eye and gets wrong.
 */
export const CONTRACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

/** It carries no agreement, and a typo fix in prose must not idle a worker. */
const OUTSIDE_THE_DIGEST = "README.md";

const NEWLINE = Buffer.from([0x0a]);

/**
 * JavaScript orders strings by UTF-16 code unit, which ranks an astral path where a byte
 * sort does not.
 */
const byByte = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

/**
 * Paths relative to `root`, `/`-separated and sorted by UTF-8 bytes. Leaves out links, any path
 * with a segment starting `.`, and the top-level README.
 */
export const contractFiles = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    // A link is a path, not content, and `isFile` is already false for one.
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .filter((relative) => !relative.split("/").some((segment) => segment.startsWith(".")))
    .filter((relative) => relative !== OUTSIDE_THE_DIGEST)
    .toSorted(byByte);

/**
 * A lowercase hex SHA-256 over each contract file's path, byte length and bytes, in turn.
 * Length-prefixed so a boundary cannot be forged: without it, content holding a newline and
 * a plausible path could pose as a second file.
 */
export const contractDigest = (root: string): string => {
  const stream = createHash("sha256");
  for (const relative of contractFiles(root)) {
    /**
     * Bytes, never decoded or newline-normalised: a CRLF checkout is a different digest, and
     * that is right — the tiers would be reading different bytes.
     */
    const content = readFileSync(path.join(root, relative));
    stream.update(Buffer.from(relative, "utf8"));
    stream.update(NEWLINE);
    stream.update(Buffer.from(String(content.length), "ascii"));
    stream.update(NEWLINE);
    stream.update(content);
  }
  return stream.digest("hex");
};

const GENERATE = "pnpm --filter @better-answers/schema run generate:contract-stamp";

export const renderContractStamp = (digest: string): string =>
  [
    `// Generated, never edited: ${GENERATE}`,
    "",
    `export const CONTRACT_DIGEST = "${digest}";`,
    "",
  ].join("\n");
