import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { facesAdmittingNobody } from "@better-answers/devtools/face-admission";

import { workspaceRoot } from "../support/roots/roots.ts";
import {
  asSliceRelative,
  coreSourceFiles,
  sourceTreeIsInstrumented,
} from "../support/source-tree.ts";

const HOLDS_NO_ACTION = ["access", "kernel", "refusals", "store"];

const STEPS: Readonly<Record<string, string>> = {
  "answering/completeRecord": "a step of ask, which admits the asker before it completes a record",
  "answering/keepDraft":
    "a step of the drafter, which admits the asker before it keeps a part's prose",
  "answering/openRecord": "a step of ask, which admits the asker before it opens a record",
  "answering/reserveDrafting":
    "a step of the drafter, which admits the asker before it reserves a part's call",
  "answering/reserveJudge":
    "a step of ask, which admits the asker before it reserves its judge's call",
  "audit/eventsNewestFirst": "the audit log's read calls it after admitting an Admin",
  "audit/eventsSoughtNewestFirst":
    "the audit log's read and a member's activity call it after admitting an Admin",
  "audit/record": "writes the audit event of the action that called it, in its transaction",
  "audit/recordEach": "writes the audit events of the action that called it, in its transaction",
  "bundle/authorOf": "an admitted write reads the git author of the person it names",
  "bundle/commitAndLandAsMember":
    "an admitted write commits through it, and it runs that write's own checks",
  "bundle/landBundleCommit": "an admitted write and the reconciler land their commit's row",
  "bundle/withBundleWrite": "takes the lock for a write that admitted its person first",
  "concepts/cascadingVisibility": "runs its caller's write, and that write's own checks",
  "concepts/conceptCountsOf": "find and ask call it with the reader they admitted",
  "concepts/evidenceOf": "ask calls it with the reader it admitted",
  "concepts/findConcepts": "find and ask call it with the reader they admitted",
  "concepts/ownerOf": "an act that admitted a person reads it, and it decides nothing",
  "concepts/standingOnConcept": "open calls it with the reader it admitted, and it decides nothing",
  "concepts/readConcept": "open calls it with the reader it admitted",
  "guides/flagWriteUpsCiting": "a landed write and its replay call it in their own transaction",
  "guides/recomputeWriteUpsIncluding":
    "a visibility change and a landed write call it in their own transaction",
  "guides/writeSkeleton": "runs inside the withBundleWrite of an act that admitted its person",
  "llm/reserveSpend": "a step of ask, which admits the asker before it reserves a call's spend",
  "llm/resolveModel": "a step of ask, which admits the asker before it resolves the model it calls",
  "llm/settleSpend": "a step of ask, which admits the asker before it settles a call's spend",
  "members/eventsAsked": "the audit log's read and its export call it after admitting an Admin",
  "members/eventsNamed":
    "the audit log's read, its export and a member's activity call it after admitting an Admin",
  "members/returnUnsentEmails":
    "takes only what an invite or resend counted after admitting an Admin, and gives it back",
  "runs/enqueueJob": "opens the transaction enqueueJobIn admits in",
  "sources/findPassages": "ask calls it with the reader it admitted",
  "sources/findPassagesWithOpening": "find calls it with the reader it admitted",
  "sources/passageAt": "open, ask and a concept's read call it for the reader each admitted",
  "sources/passageCountsOf": "find and ask call it with the reader they admitted",
};

const NO_LISTED_STEP = "takes a person, admits nobody and is no listed step";

const stepLine = (step: string): string => `${step}: ${STEPS[step] ?? NO_LISTED_STEP}`;

const SRC = "./src/";

const exportedFaces = (): readonly string[] => {
  const manifest = z
    .object({ exports: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(path.resolve(workspaceRoot, "package.json"), "utf8")));
  return Object.values(manifest.exports)
    .filter((target) => target.startsWith(SRC))
    .map((target) => target.slice(SRC.length));
};

const directories = (): readonly string[] => [
  ...new Set(asSliceRelative(coreSourceFiles()).map((file) => file.split("/")[0] ?? file)),
];

describe("the faces of core, each admitting whoever it takes", () => {
  it.skipIf(sourceTreeIsInstrumented())(
    "finds a person admitted by every function but the steps",
    () => {
      const files = coreSourceFiles();
      const sources = Object.fromEntries(
        files.flatMap((file) =>
          asSliceRelative([file]).map((relative) => [relative, readFileSync(file, "utf8")]),
        ),
      );
      const faces = directories().filter((directory) => !HOLDS_NO_ACTION.includes(directory));

      const found = facesAdmittingNobody(sources, faces).map(({ face, name }) =>
        stepLine(`${face}/${name}`),
      );

      expect(found.toSorted()).toEqual(
        Object.entries(STEPS)
          .map(([step, why]) => `${step}: ${why}`)
          .toSorted(),
      );
    },
  );

  it("leaves out only directories the tree has", () => {
    const inTree = directories();

    expect(HOLDS_NO_ACTION.filter((directory) => !inTree.includes(directory))).toEqual([]);
  });

  it("reads every face the package exports, or leaves it out", () => {
    const read = (face: string): boolean => /^[^/]+\/index\.ts$/.test(face);
    const leftOut = (face: string): boolean =>
      HOLDS_NO_ACTION.some((directory) => face.startsWith(`${directory}/`));

    expect(
      exportedFaces()
        .filter((face) => !read(face))
        .filter((face) => !leftOut(face)),
    ).toEqual([]);
    expect(exportedFaces()).toContain("answering/index.ts");
  });

  it("gives every step the action that admits for it", () => {
    expect(Object.values(STEPS).filter((why) => why.trim() === "")).toEqual([]);
  });
});
