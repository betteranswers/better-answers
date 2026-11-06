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
  edits: z.array(z.object({ file: z.string(), original: z.base64(), text: z.string() })),
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
  execFileSync("git", ["-C", root, "mv", "--", from, to], { stdio: "pipe" });
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

const isMovedOnly = (root: string, from: string, to: string): boolean =>
  existsSync(path.join(root, to)) && !existsSync(path.join(root, from));

/** Where an edited file is now: still at its new path if its move back has not happened. */
const whereNow = (root: string, written: Journal, file: string): string => {
  const to = written.moves.find(([from]) => from === file)?.[1];
  return to !== undefined && isMovedOnly(root, file, to) ? to : file;
};

/** Each step reads the tree first, so an undo that stopped part way can run again. */
const undo = (root: string, written: Journal): readonly string[] => {
  const failures: string[] = [];
  const attempt = (step: () => void, mayBeGone = false): void => {
    try {
      step();
    } catch (cause) {
      if (!(mayBeGone && isEmptyFolderGone(cause))) failures.push(messageOf(cause));
    }
  };
  for (const [from, to] of [...written.moves].reverse()) {
    attempt(() => {
      if (isMovedOnly(root, from, to)) gitMove(root, to, from);
    });
  }
  for (const { file, original } of written.edits) {
    // A file whose move back failed gets its text back where it is, so a rerun can move it back.
    const at = whereNow(root, written, file);
    attempt(() => {
      writeFileSync(path.join(root, at), Buffer.from(original, "base64"));
    });
  }
  for (const folder of written.created) {
    attempt(() => {
      rmdirSync(path.join(root, folder));
    }, true);
  }
  return failures;
};

/** A file edited by hand after the stopped run is neither its original nor the run's text. */
const editedSince = (root: string, written: Journal): readonly string[] => {
  return written.edits.flatMap(({ file, original, text }) => {
    const at = path.join(root, whereNow(root, written, file));
    const now = existsSync(at) ? readFileSync(at) : undefined;
    const kept =
      now !== undefined &&
      (now.equals(Buffer.from(original, "base64")) || now.toString("utf8") === text);
    return kept ? [] : [file];
  });
};

const undoOrThrow = (root: string, file: string, written: Journal): void => {
  const changed = editedSince(root, written);
  if (changed.length > 0) {
    throw new Error(
      `files changed after the stopped run, so its move is not undone; restore or keep each by hand, then delete ${file}:\n${changed.join("\n")}`,
    );
  }
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

/** The listings take a minute or more, so a file edited meanwhile stops the move instead of being lost. */
const changedSince = (root: string, { edits, moves }: Change): readonly string[] => [
  ...edits
    .filter(({ file, original }) => !readFileSync(path.join(root, file)).equals(original))
    .map(({ file }) => file),
  ...[...moves]
    .filter(([from, to]) => !existsSync(path.join(root, from)) || existsSync(path.join(root, to)))
    .map(([from]) => from),
];

export const applyChange = (root: string, change: Change): void => {
  const { edits, moves } = change;
  const changed = changedSince(root, change);
  if (changed.length > 0) {
    throw new Error(
      `the tree changed while move-files listed the tests, so nothing moved:\n${changed.join("\n")}`,
    );
  }
  const file = journalPath(root);
  const written: Journal = {
    edits: edits.map(({ file: edited, original, text }) => ({
      file: edited,
      original: original.toString("base64"),
      text,
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
