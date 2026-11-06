import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

export type Edit = { readonly file: string; readonly original: Buffer; readonly text: string };

export type Change = {
  readonly edits: readonly Edit[];
  readonly moves: ReadonlyMap<string, string>;
};

/** What the tree held before a move, written before the move touches it, so a rerun can undo it. */
const journal = z.object({
  edits: z.array(z.object({ file: z.string(), original: z.base64() })),
  moves: z.array(z.tuple([z.string(), z.string()])),
  created: z.array(z.string()),
});

type Journal = z.infer<typeof journal>;

export const gitDirOf = (root: string): string =>
  execFileSync("git", ["-C", root, "rev-parse", "--absolute-git-dir"], {
    encoding: "utf8",
  }).trim();

const journalPath = (root: string): string => path.join(gitDirOf(root), "move-files-journal.json");

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const gitMove = (root: string, from: string, to: string): void => {
  mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  execFileSync("git", ["-C", root, "mv", from, to], { stdio: "pipe" });
};

/** The folders a move creates, deepest first, so an undo can remove each once it is empty. */
const createdBy = (root: string, moves: ReadonlyMap<string, string>): readonly string[] => {
  const created = new Set<string>();
  for (const to of moves.values()) {
    for (let at = path.posix.dirname(to); at !== "." && !existsSync(path.join(root, at));) {
      created.add(at);
      at = path.posix.dirname(at);
    }
  }
  return [...created].sort((one, other) => other.split("/").length - one.split("/").length);
};

const isEmptyFolderGone = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTEMPTY");

/** Each step checks the tree first, so an undo that stopped part way can run again. */
const undo = (root: string, written: Journal): readonly string[] => {
  const failures: string[] = [];
  const attempt = (step: () => void): void => {
    try {
      step();
    } catch (cause) {
      if (!isEmptyFolderGone(cause)) failures.push(messageOf(cause));
    }
  };
  for (const [from, to] of [...written.moves].reverse()) {
    attempt(() => {
      if (existsSync(path.join(root, to)) && !existsSync(path.join(root, from))) {
        gitMove(root, to, from);
      }
    });
  }
  for (const { file, original } of written.edits) {
    attempt(() => {
      writeFileSync(path.join(root, file), Buffer.from(original, "base64"));
    });
  }
  for (const folder of written.created) {
    attempt(() => {
      rmdirSync(path.join(root, folder));
    });
  }
  return failures;
};

const undoOrThrow = (root: string, file: string, written: Journal): void => {
  const failures = undo(root, written);
  if (failures.length > 0) {
    throw new Error(
      `the move could not be undone, so the tree is part moved; run move-files again to retry the undo\n${failures.join("\n")}`,
    );
  }
  rmSync(file, { force: true });
};

export const undoInterrupted = (root: string): boolean => {
  const file = journalPath(root);
  if (!existsSync(file)) return false;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  undoOrThrow(root, file, journal.parse(parsed));
  return true;
};

export const hasInterrupted = (root: string): boolean => existsSync(journalPath(root));

export const applyChange = (root: string, { edits, moves }: Change): void => {
  const file = journalPath(root);
  const written: Journal = {
    edits: edits.map(({ file: edited, original }) => ({
      file: edited,
      original: original.toString("base64"),
    })),
    moves: [...moves],
    created: [...createdBy(root, moves)],
  };
  writeFileSync(`${file}.next`, JSON.stringify(written));
  renameSync(`${file}.next`, file);
  try {
    for (const { file: edited, text } of edits) writeFileSync(path.join(root, edited), text);
    for (const [from, to] of moves) gitMove(root, from, to);
  } catch (cause) {
    try {
      undoOrThrow(root, file, written);
    } catch (stuck) {
      throw new Error(`${messageOf(cause)}\n${messageOf(stuck)}`, { cause });
    }
    throw cause;
  }
  rmSync(file);
};
