import { getTableName, type Table } from "drizzle-orm";

import { IMPORT_SENSITIVITY_DEFAULT } from "@better-answers/core/concepts";
import { err, ok, type Result } from "@better-answers/core/kernel";
import { CHOOSABLE_PROVIDERS, DECISION_PROVIDERS } from "@better-answers/core/llm";
import { ORPHANED_UPLOAD_GRACE_HOURS } from "@better-answers/core/sources";
import { tablesPresent } from "@better-answers/core/store/postgres";
import {
  bundleCommit,
  conceptIndex,
  conceptVerification,
  connectedSource,
  decisionThreshold,
  erasureRequest,
  mapEdge,
  mapGeneration,
  mapNode,
  mapUnresolvedReference,
  job,
  llmCall,
  MODEL_PROVIDERS,
  modelChoice,
  modelKey,
  modelPrice,
  questionAsked,
  questionFeedback,
  REBUILD_REASONS,
  ROLES,
  SENSITIVITIES,
  sourceDocument,
  spendReservation,
  suppression,
} from "@better-answers/schema";

import type { Doors } from "../doors.ts";
import { unmappedPassageRateCommand } from "./answering.ts";
import {
  DONE,
  REFUSED,
  USAGE,
  NOT_BUILT,
  EXIT_OF_CLASS,
  type OpsIo,
  type Flags,
  parseFlags,
  flagValue,
} from "./cli.ts";
import {
  bodyAskedOf,
  importAskedOf,
  importBundleCommand,
  reconcileWatermark,
  updateConceptBodyCommand,
} from "./concepts.ts";
import {
  erasureRehearsal,
  rehearsalAskedOf,
  replayErasuresAskedOf,
  replayErasuresCommand,
} from "./erasure.ts";
import { WAIT_SECONDS } from "./job-wait.ts";
import {
  CHOSEN_PURPOSES,
  setDecisionThresholdAskedOf,
  setDecisionThresholdCommand,
  setModelChoiceAskedOf,
  setModelChoiceCommand,
  setModelKeyAskedOf,
  setModelKeyCommand,
  setModelPriceAskedOf,
  setModelPriceCommand,
  setSpendingLimitAskedOf,
  setSpendingLimitCommand,
} from "./llm.ts";
import {
  REBUILD_DEFAULT_REASON,
  mapCountsCommand,
  mapRebuildAskedOf,
  mapRebuildCommand,
  mapSweepCommand,
} from "./map.ts";
import {
  operatorAskedOf,
  operatorCommand,
  restoreSignInAskedOf,
  restoreSignInCommand,
} from "./operator.ts";
import { dumpGrep, dumpGrepAskedOf, smoke, smokeAskedOf } from "./restore-checks.ts";
import {
  objectStoreOrphans,
  objectStoreOrphansAskedOf,
  reindexConnectedSources,
} from "./sources.ts";
import {
  addMemberAskedOf,
  addMemberCommand,
  addPersonAskedOf,
  addPersonCommand,
  provisionWorkspaceAskedOf,
  provisionWorkspaceCommand,
  renameWorkspaceAskedOf,
  renameWorkspaceCommand,
} from "./workspaces.ts";

export { EXIT_OF_CLASS, NOT_BUILT, parseSince, reasonOf, type OpsIo } from "./cli.ts";

const MAP_TABLES = [mapGeneration, mapNode, mapEdge];

const NEEDS = {
  "map-rebuild": [...MAP_TABLES, mapUnresolvedReference, job],
  "map-sweep": [...MAP_TABLES, mapUnresolvedReference],
  "map-counts": MAP_TABLES,
  "unmapped-passage-rate": [questionAsked, questionFeedback],
  "reconcile-watermark": [conceptIndex, bundleCommit],
  "object-store-orphans": [sourceDocument],
  "reindex-connected-sources": [connectedSource, job],
  "erasure-rehearsal": [erasureRequest, suppression],
  "import-bundle": [conceptIndex, bundleCommit, conceptVerification],
  "update-concept-body": [conceptIndex, bundleCommit],
  "set-model-key": [modelKey],
  "set-spending-limit": [llmCall, spendReservation],
  "set-model-choice": [modelChoice, modelPrice, decisionThreshold],
};

type SliceCommand = keyof typeof NEEDS;

const isSliceCommand = (command: string): command is SliceCommand => Object.hasOwn(NEEDS, command);

export const SLICE_COMMANDS: readonly SliceCommand[] = Object.keys(NEEDS).filter(isSliceCommand);

const USAGE_TEXT = `usage: pnpm ops <command> [options]
  replay-erasures --since <dump stamp | ISO instant>      re-apply every erasure completed after a dump (mandatory in every restore)
  map-rebuild --workspace <id> [--reason <word>] [--wait | --wait-seconds <n>]   the map made again by the worker
    --reason  one of ${REBUILD_REASONS.join(" · ")} (default ${REBUILD_DEFAULT_REASON})
    --wait    poll the job until it is over, ${WAIT_SECONDS} seconds — the rebuild's own budget
    --wait-seconds <n>  the same, for a whole number of seconds an operator names instead
  map-sweep --workspace <id>                                delete every generation of the map but the live one
  map-counts --workspace <id>                               nodes per label and edges, as JSON, for the drill's diff
  unmapped-passage-rate --workspace <id>                    the records flagged incomplete, and how many of them showed unmapped passages, by the map's state, as JSON
  reconcile-watermark --workspace <id>                      recovery order step 2: replay the commits the rows missed
  object-store-orphans --workspace <id> [--list]            recovery order step 5: remove the originals a failed connect or a lost race left, past a ${ORPHANED_UPLOAD_GRACE_HOURS}-hour grace, that no document row names
    --list         say how many there are, removing none
  reindex-connected-sources --workspace <id>                every connected source wiped and queued to index again, as a release that renames the engine's target needs
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
  erasure-rehearsal --workspace <id> --synthetic --seed [--wait-seconds <n>]
                                                            phase one: the synthetic subject and a document naming them, waited on until indexed; its tokens on the last line
    --wait-seconds <n>  how long to wait for the document's index job (default ${WAIT_SECONDS})
  erasure-rehearsal --workspace <id> --synthetic --run --report <file>   phase two: erase them, write the report, print the tokens again
  dump-grep --tokens <a,b,…>                                stdin: a plain-SQL dump; per token, which COPY section holds it and in how many lines — never a line
  provision-workspace --name <name> --short-name <short name> --admin <email>
                                                            a customer's workspace with its first Admin, a person who has signed in; the id it minted is first on the done line
  add-person --email <address> --name <display name>
                                                            a person named before their first sign-in, so add-member can take them; the id it minted is first on the done line
  add-member --workspace <id> --email <email> --role <${ROLES.join("|")}>
                                                            a signed-in person made a member of the workspace; a repeat is refused and never changes a role
  rename-workspace --workspace <id> [--name <name>] [--short-name <short name>]
                                                            the workspace's name, its short name, or both; at least one is named, and the other kept
  set-model-key --workspace <id> --provider <${MODEL_PROVIDERS.join("|")}>
                                                            stdin: the workspace's key for that model provider, sealed and never printed; a second run replaces it
  set-spending-limit --workspace <id> --gbp <pounds>        the most the workspace's model calls may spend each calendar month; a second run replaces it, and with none set no model is called
  set-model-choice --workspace <id> --purpose <${CHOSEN_PURPOSES.join("|")}> --provider <${[...CHOOSABLE_PROVIDERS].join("|")}> --model <model>
                                                            the model the workspace calls for that purpose, priced and named by the DPIA; a second run replaces it
  set-model-price --provider <${MODEL_PROVIDERS.join("|")}> --model <model> --from <yyyy-mm-dd> --gbp-per-million-in <pounds> --gbp-per-million-out <pounds>
                                                            what a model costs from that day on, per million tokens sent and returned; a model with no price is never called
  set-decision-threshold --provider <${DECISION_PROVIDERS.join("|")}> --model <model> --threshold <probability>
                                                            the probability at or above which a decision model's yes is taken; a second run replaces it, and with none set the model never judges
  operator --email <email> --grant|--revoke                 a signed-in person made the platform's operator, or no longer; each change on the identity-set audit log
  restore-sign-in --email <email>                           a person who lost every factor and code, once you have checked who they are another way: their factors and sessions ended, a notice sent, a one-time restore code printed
  import-bundle --workspace <id> --from <directory> --as <member email> [--sensitivity <sensitivity>] [--dry-run]
                                                            the company's bundle landed through the governed write, its verifications imported, its links rewritten to iris
    --sensitivity  one of ${SENSITIVITIES.join(" · ")} (default ${IMPORT_SENSITIVITY_DEFAULT})
    --dry-run      validate the tree and say what a run would do, writing nothing
  update-concept-body --workspace <id> --iri <iri> --as <member email> [--expect <content hash>] [--dry-run]
                                                            stdin: the concept's new body; it replaces the body alone, keeping frontmatter, status, verification and citations
    --expect   the content hash the concept stands at, required on a write; a dry run prints it
    --dry-run  print the hash the concept stands at and the body's diff, writing nothing
exit codes: ${DONE} done · ${REFUSED} refused in no refusal word, stop · ${USAGE} usage, or a malformed argument · ${NOT_BUILT} the slice this needs has no tables yet
  a refusal word exits with its class's code: ${Object.entries(EXIT_OF_CLASS)
    .map(([refusalClass, code]) => `${code} ${refusalClass}`)
    .join(" · ")}
  a run that names the file or commit it stopped at exits ${REFUSED}, whatever word it names: import-bundle's unsound tree and stopped import, reconcile-watermark's stopped replay
  an import whose manifest commit is refused as malformed exits ${REFUSED} too: only a defect in the import can cause it`;

const notBuiltSaid = async (doors: Doors, command: SliceCommand): Promise<string | undefined> => {
  const tables: readonly Table[] = NEEDS[command];
  const needed = tables.map((table) => getTableName(table));
  const present = await tablesPresent(doors.postgres, needed);
  return present.length < needed.length
    ? `${command}: not built — ${needed.filter((name) => !present.includes(name)).join(", ")} absent from this schema; the slice that owns them has not landed`
    : undefined;
};

type OpsCommand = {
  readonly name: string;
  readonly asked: object;
  readonly run: (doors: Doors, io: OpsIo) => Promise<number>;
};

type Parser = (name: string, flags: Flags) => Result<OpsCommand, string>;

const NO_FLAGS = (): Result<object, string> => ok({});

const parserOf =
  <Asked extends object>(
    asked: (flags: Flags) => Result<Asked, string>,
    run: (doors: Doors, asked: Asked, io: OpsIo) => Promise<number>,
  ): Parser =>
  (name, flags) => {
    const parsed = asked(flags);
    return parsed.ok
      ? ok({ name, asked: parsed.value, run: (doors, io) => run(doors, parsed.value, io) })
      : err(`${name}: ${parsed.error}`);
  };

const inWorkspaceParserOf =
  <Asked extends object>(
    asked: (flags: Flags) => Result<Asked, string>,
    run: (doors: Doors, workspaceId: string, asked: Asked, io: OpsIo) => Promise<number>,
  ): Parser =>
  (name, flags) => {
    const workspaceId = flagValue(flags, "workspace");
    if (workspaceId === undefined) return err(`${name}: --workspace <id> is required`);
    const parsed = asked(flags);
    return parsed.ok
      ? ok({
          name,
          asked: { workspaceId, ...parsed.value },
          run: (doors, io) => run(doors, workspaceId, parsed.value, io),
        })
      : err(`${name}: ${parsed.error}`);
  };

const inWorkspaceAloneOf = (
  run: (doors: Doors, workspaceId: string, io: OpsIo) => Promise<number>,
): Parser =>
  inWorkspaceParserOf(NO_FLAGS, (doors, workspaceId, _asked, io) => run(doors, workspaceId, io));

const helpSaid = async (io: OpsIo): Promise<number> => {
  io.say(USAGE_TEXT);
  return DONE;
};

const PARSERS = new Map<string, Parser>([
  ["help", parserOf(NO_FLAGS, (_doors, _asked, io) => helpSaid(io))],
  ["replay-erasures", parserOf(replayErasuresAskedOf, replayErasuresCommand)],
  ["smoke", parserOf(smokeAskedOf, (_doors, asked, io) => smoke(asked, io))],
  ["dump-grep", parserOf(dumpGrepAskedOf, (_doors, asked, io) => dumpGrep(asked, io))],
  ["provision-workspace", parserOf(provisionWorkspaceAskedOf, provisionWorkspaceCommand)],
  ["add-person", parserOf(addPersonAskedOf, addPersonCommand)],
  ["add-member", parserOf(addMemberAskedOf, addMemberCommand)],
  ["rename-workspace", parserOf(renameWorkspaceAskedOf, renameWorkspaceCommand)],
  ["set-model-price", parserOf(setModelPriceAskedOf, setModelPriceCommand)],
  ["set-decision-threshold", parserOf(setDecisionThresholdAskedOf, setDecisionThresholdCommand)],
  ["operator", parserOf(operatorAskedOf, operatorCommand)],
  ["restore-sign-in", parserOf(restoreSignInAskedOf, restoreSignInCommand)],
  ["map-rebuild", inWorkspaceParserOf(mapRebuildAskedOf, mapRebuildCommand)],
  ["map-sweep", inWorkspaceAloneOf(mapSweepCommand)],
  ["map-counts", inWorkspaceAloneOf(mapCountsCommand)],
  ["unmapped-passage-rate", inWorkspaceAloneOf(unmappedPassageRateCommand)],
  ["reconcile-watermark", inWorkspaceAloneOf(reconcileWatermark)],
  ["object-store-orphans", inWorkspaceParserOf(objectStoreOrphansAskedOf, objectStoreOrphans)],
  ["reindex-connected-sources", inWorkspaceAloneOf(reindexConnectedSources)],
  ["erasure-rehearsal", inWorkspaceParserOf(rehearsalAskedOf, erasureRehearsal)],
  ["import-bundle", inWorkspaceParserOf(importAskedOf, importBundleCommand)],
  ["update-concept-body", inWorkspaceParserOf(bodyAskedOf, updateConceptBodyCommand)],
  ["set-model-key", inWorkspaceParserOf(setModelKeyAskedOf, setModelKeyCommand)],
  ["set-spending-limit", inWorkspaceParserOf(setSpendingLimitAskedOf, setSpendingLimitCommand)],
  ["set-model-choice", inWorkspaceParserOf(setModelChoiceAskedOf, setModelChoiceCommand)],
]);

export const parseOpsArgs = (argv: readonly string[]): Result<OpsCommand, string> => {
  const [typed, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;
  if (typed === undefined) return err(USAGE_TEXT);
  const name = typed === "--help" ? "help" : typed;
  return (
    PARSERS.get(name)?.(name, parseFlags(rest)) ?? err(`unknown command: ${name}\n${USAGE_TEXT}`)
  );
};

export const runOps = async (argv: readonly string[], doors: Doors, io: OpsIo): Promise<number> => {
  const parsed = parseOpsArgs(argv);
  if (!parsed.ok) {
    io.say(parsed.error);
    return USAGE;
  }
  const { name, run } = parsed.value;
  if (isSliceCommand(name)) {
    const absent = await notBuiltSaid(doors, name);
    if (absent !== undefined) {
      io.say(absent);
      return NOT_BUILT;
    }
  }
  return run(doors, io);
};
