import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");

const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/(?<file>[^/@]+)$/;

const LEVELS = ["none", "read", "write"] as const;
type Level = (typeof LEVELS)[number];

const permissionsSchema = z.union([
  z.enum(["read-all", "write-all"]),
  z.record(z.string(), z.enum(LEVELS)),
]);
type Permissions = z.infer<typeof permissionsSchema>;

const workflowSchema = z.object({
  permissions: permissionsSchema.optional(),
  jobs: z.record(
    z.string(),
    z.object({ uses: z.string().optional(), permissions: permissionsSchema.optional() }),
  ),
});
type Workflow = z.infer<typeof workflowSchema>;
type Workflows = ReadonlyMap<string, Workflow>;

/** A map leaves every scope it does not list at `none`; a `-all` shorthand lists none and sets them all. */
type Grant = { readonly scopes: Readonly<Record<string, Level>>; readonly rest: Level };

const grantOf = (declared: Permissions): Grant => {
  if (declared === "write-all") return { scopes: {}, rest: "write" };
  if (declared === "read-all") return { scopes: {}, rest: "read" };
  return { scopes: declared, rest: "none" };
};

const levelIn = (grant: Grant, scope: string): Level => grant.scopes[scope] ?? grant.rest;

const exceeds = (asked: Level, given: Level): boolean =>
  LEVELS.indexOf(asked) > LEVELS.indexOf(given);

const shortfallsBetween = (asked: Grant, given: Grant): readonly string[] => {
  const scopes = [...new Set([...Object.keys(asked.scopes), ...Object.keys(given.scopes)])].sort();
  const named = scopes.flatMap((scope) =>
    exceeds(levelIn(asked, scope), levelIn(given, scope))
      ? [`${scope}: asks ${levelIn(asked, scope)}, granted ${levelIn(given, scope)}`]
      : [],
  );
  const rest = exceeds(asked.rest, given.rest)
    ? [`every other scope: asks ${asked.rest}, granted ${given.rest}`]
    : [];
  return [...named, ...rest];
};

const CHECK_USES = "./.github/workflows/check.yml";

type Call = {
  readonly caller: string;
  readonly uses: string;
  readonly granted: Permissions | undefined;
};

/** A job's own `permissions:` replaces its workflow's rather than adding to it. */
const callsIn = (workflows: Workflows): readonly Call[] =>
  [...workflows].flatMap(([file, workflow]) =>
    Object.entries(workflow.jobs).flatMap(([job, { uses, permissions }]) =>
      uses === undefined
        ? []
        : [{ caller: `${file}'s \`${job}\``, uses, granted: permissions ?? workflow.permissions }],
    ),
  );

type Asker = { readonly who: string; readonly asks: Permissions };

/** Each is checked before the run starts, whatever a job's `if:` says. A job with no block of its own asks for the workflow's. */
const askersIn = (file: string, called: Workflow): readonly Asker[] => [
  ...(called.permissions === undefined
    ? []
    : [{ who: `${file}'s top-level \`permissions:\``, asks: called.permissions }]),
  ...Object.entries(called.jobs).flatMap(([job, { permissions }]) =>
    permissions === undefined ? [] : [{ who: `${file}'s \`${job}\``, asks: permissions }],
  ),
];

const shortfallsOf = (call: Call, workflows: Workflows): readonly string[] => {
  const file = LOCAL_WORKFLOW.exec(call.uses)?.groups?.["file"] ?? "";
  const called = workflows.get(file);
  if (called === undefined) {
    return [`${call.caller} calls \`${call.uses}\`, which is not a workflow in this directory`];
  }
  if (call.granted === undefined) {
    return [`${call.caller} grants the repository's default, which no workflow file names`];
  }
  const given = grantOf(call.granted);
  return askersIn(file, called).flatMap(({ who, asks }) =>
    shortfallsBetween(grantOf(asks), given).map((gap) => `${call.caller} → ${who}: ${gap}`),
  );
};

const shortfallsIn = (workflows: Workflows): readonly string[] =>
  callsIn(workflows).flatMap((call) => shortfallsOf(call, workflows));

const workflowsOnDisk = (): Workflows =>
  new Map(
    readdirSync(workflowDirectory)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file): [string, Workflow] => [
        file,
        workflowSchema.parse(parse(readFileSync(path.join(workflowDirectory, file), "utf8"))),
      ]),
  );

describe("what a job calling a reusable workflow grants it", () => {
  it("grants every scope the called workflow asks for", () => {
    expect(
      shortfallsIn(workflowsOnDisk()),
      "a job calling a reusable workflow grants less than that workflow or one of its jobs asks for, so GitHub fails the whole run at startup (`startup_failure`), whatever the asking job's `if:` says. Give the calling job a `permissions:` block naming every scope listed here at the level asked, with the scopes its workflow's own block already gave. A call whose grant or callee this test cannot read is refused as well: name the grant in the calling file, and call a workflow kept in this directory.",
    ).toEqual([]);
  });

  it("reads build.yml's call to check.yml", () => {
    expect(callsIn(workflowsOnDisk())).toContainEqual(
      expect.objectContaining({ caller: "build.yml's `check`", uses: CHECK_USES }),
    );
  });
});

const callingWith = (permissions: Workflow["permissions"]): Workflow => ({
  permissions: { contents: "read" },
  jobs: { check: { uses: CHECK_USES, permissions } },
});

const CHECK_WITH_PR_TITLE: Workflow = {
  permissions: { contents: "read" },
  jobs: {
    lane: {},
    "pr-title": { permissions: { contents: "read", "pull-requests": "read" } },
  },
};

describe.each<{
  readonly shape: string;
  readonly caller: Workflow;
  readonly called: Workflow;
  readonly expected: readonly string[];
}>([
  {
    shape: "the workflow's grant alone, short of pr-title's",
    caller: callingWith(undefined),
    called: CHECK_WITH_PR_TITLE,
    expected: [
      "build.yml's `check` → check.yml's `pr-title`: pull-requests: asks read, granted none",
    ],
  },
  {
    shape: "a job grant naming what pr-title asks",
    caller: callingWith({ contents: "read", "pull-requests": "read" }),
    called: CHECK_WITH_PR_TITLE,
    expected: [],
  },
  {
    shape: "a job grant dropping the workflow's contents",
    caller: callingWith({ "pull-requests": "read" }),
    called: CHECK_WITH_PR_TITLE,
    expected: [
      "build.yml's `check` → check.yml's top-level `permissions:`: contents: asks read, granted none",
      "build.yml's `check` → check.yml's `pr-title`: contents: asks read, granted none",
    ],
  },
  {
    shape: "less than a fully overridden top-level block",
    caller: callingWith(undefined),
    called: {
      permissions: { "pull-requests": "write" },
      jobs: { lane: { permissions: { contents: "read" } } },
    },
    expected: [
      "build.yml's `check` → check.yml's top-level `permissions:`: pull-requests: asks write, granted none",
    ],
  },
  {
    shape: "write where read is asked",
    caller: callingWith({ contents: "write", "pull-requests": "write" }),
    called: CHECK_WITH_PR_TITLE,
    expected: [],
  },
  {
    shape: "nothing to a workflow asking nothing",
    caller: callingWith({}),
    called: { jobs: { lane: {} } },
    expected: [],
  },
  {
    shape: "read-all where a map is asked",
    caller: callingWith("read-all"),
    called: CHECK_WITH_PR_TITLE,
    expected: [],
  },
  {
    shape: "a map where read-all is asked",
    caller: callingWith(undefined),
    called: { jobs: { lane: { permissions: "read-all" } } },
    expected: [
      "build.yml's `check` → check.yml's `lane`: every other scope: asks read, granted none",
    ],
  },
  {
    shape: "no grant anywhere in the calling file",
    caller: { jobs: { check: { uses: CHECK_USES } } },
    called: CHECK_WITH_PR_TITLE,
    expected: ["build.yml's `check` grants the repository's default, which no workflow file names"],
  },
  {
    shape: "to a workflow from outside this directory",
    caller: { permissions: {}, jobs: { check: { uses: "octo/ci/.github/workflows/x.yml@main" } } },
    called: CHECK_WITH_PR_TITLE,
    expected: [
      "build.yml's `check` calls `octo/ci/.github/workflows/x.yml@main`, which is not a workflow in this directory",
    ],
  },
])("a call granting $shape", ({ caller, called, expected }) => {
  it("names each scope granted short of what is asked", () => {
    expect(
      shortfallsIn(
        new Map([
          ["build.yml", caller],
          ["check.yml", called],
        ]),
      ),
    ).toEqual(expected);
  });
});
