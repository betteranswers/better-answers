import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { facesAdmittingNobody } from "@better-answers/devtools/face-admission";

import { asSliceRelative, coreSourceFiles, sourceTreeIsInstrumented } from "./source-tree.ts";

/** A directory under `src` that holds no action; every other one is a face and is read. */
const HOLDS_NO_ACTION = ["access", "kernel", "refusals", "store"];

/** Each step a face exports, with the action that admits before it runs. */
const STEPS: Readonly<Record<string, string>> = {
  "audit/eventsNewestFirst": "the audit log's read calls it after admitting an Admin",
  "audit/eventsSoughtNewestFirst":
    "the audit log's read and a member's activity call it after admitting an Admin",
  "audit/record": "writes the audit event of the action that called it, in its transaction",
  "audit/recordEach": "writes the audit events of the action that called it, in its transaction",
  "concepts/cascadingVisibility": "runs its caller's write, and that write's own checks",
  "concepts/findConcepts": "find and ask call it with the reader they admitted",
  "concepts/readConcept": "open calls it with the reader it admitted",
  "guides/recomputeWriteUpsIncluding":
    "a visibility change and a landed write call it in their own transaction",
  "members/eventsAsked": "the audit log's read and its export call it after admitting an Admin",
  "members/eventsNamed":
    "the audit log's read, its export and a member's activity call it after admitting an Admin",
  "runs/enqueueJob": "opens the transaction enqueueJobIn admits in",
  "sources/findPassages": "find calls it with the reader it admitted",
  "sources/passageAt": "open and a concept's read call it for the reader open admitted",
};

const NO_LISTED_STEP = "takes a person, admits nobody and is no listed step";

const SRC = "./src/";

/** What a transport can import: the faces the package's exports map names under `src`. */
const exportedFaces = (): readonly string[] => {
  const manifest = z
    .object({ exports: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")));
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
        asSliceRelative(files).map((file, index) => [
          file,
          readFileSync(files[index] ?? file, "utf8"),
        ]),
      );
      const faces = directories().filter((directory) => !HOLDS_NO_ACTION.includes(directory));

      const found = facesAdmittingNobody(sources, faces).map(({ face, name }) => {
        const step = `${face}/${name}`;
        return `${step}: ${STEPS[step] ?? NO_LISTED_STEP}`;
      });

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

    expect(exportedFaces().filter((face) => !read(face) && !leftOut(face))).toEqual([]);
    expect(exportedFaces()).toContain("answering/index.ts");
  });

  it("gives every step the action that admits for it", () => {
    expect(Object.values(STEPS).filter((why) => why.trim() === "")).toEqual([]);
  });
});
