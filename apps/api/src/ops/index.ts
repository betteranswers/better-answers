import { getTableName, type Table } from "drizzle-orm";

import { IMPORT_SENSITIVITY_DEFAULT } from "@better-answers/core/concepts";
import { err, ok, type Result } from "@better-answers/core/kernel";
import { CHOOSABLE_PROVIDERS, DECISION_PROVIDERS } from "@better-answers/core/llm";
import { ORPHANED_UPLOAD_GRACE_HOURS } from "@better-answers/core/sources";
import { tablesPresent } from "@better-answers/core/store/postgres";
import {
  bundleCommit,
  conceptIdentity,
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
  refoldConceptTypesCommand,
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
  "refold-concept-types": [conceptIndex, conceptIdentity],
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
  replay-erasures --since <dump stamp | ISO instant>      Re-applies every erasure completed after the dump was taken. Run it in every restore.
  map-rebuild --workspace <id> [--reason <word>] [--wait | --wait-seconds <n>]
                                                            Queues a job for the worker to rebuild the workspace's map.
    --reason  The reason recorded with the job: ${REBUILD_REASONS.join(", ")} (default ${REBUILD_DEFAULT_REASON}).
    --wait    Waits for the job to finish, for up to ${WAIT_SECONDS} seconds, the time a rebuild is allowed.
    --wait-seconds <n>  Waits for the job to finish, for up to <n> seconds.
  map-sweep --workspace <id>                                Deletes every generation of the map except the live one.
  map-counts --workspace <id>                               Prints the map's nodes per label and its edges as JSON, for the restore drill to compare.
  unmapped-passage-rate --workspace <id>                    Prints as JSON, for each map state, how many questions asked were flagged incomplete and how many of those showed unmapped passages.
  reconcile-watermark --workspace <id>                      Replays the bundle commits that the database rows are missing. This is step 2 of the recovery order.
  refold-concept-types --workspace <id>                     Folds each concept's type again from its file, and moves its merge key with the type. Run it after the fold changes.
  object-store-orphans --workspace <id> [--list]            Removes uploaded files that no document row names and that are older than ${ORPHANED_UPLOAD_GRACE_HOURS} hours, such as those a failed connect left. This is step 5 of the recovery order.
    --list         Prints how many there are and removes none.
  reindex-connected-sources --workspace <id>                Clears every connected source's passages and queues each source to index again. Run it after a release that renames the table the worker's index engine tracks.
  smoke --url <origin> [--workspace <id>] [--find] [--guide] [--ask]
                                                            Checks that the API at <origin> answers health, MCP discovery, MCP sign-in and app requests. Exits ${REFUSED} if any check fails.
    --find, --guide, --ask  Prints a reminder to test that MCP tool by hand, because it needs a signed-in token.
  erasure-rehearsal --workspace <id> --synthetic --seed [--wait-seconds <n>]
                                                            Phase one: creates a synthetic subject and a document that names them, then waits until the document is indexed. The last line holds the subject's tokens.
    --wait-seconds <n>  How long to wait for the document's index job, in seconds (default ${WAIT_SECONDS}).
  erasure-rehearsal --workspace <id> --synthetic --run --report <file>
                                                            Phase two: erases the synthetic subject, writes the report to <file>, and prints the tokens again.
  dump-grep --tokens <a,b,…>                                Reads a plain-SQL dump on stdin. For each token, prints which COPY sections hold it and in how many lines, but never the lines.
  provision-workspace --name <name> --short-name <short name> --admin <email>
                                                            Creates a customer workspace whose first Admin is a person who has signed in. The done line starts with the new workspace id.
  add-person --email <address> --name <display name>
                                                            Adds a person before their first sign-in, so that add-member can add them to a workspace. The done line starts with the new person id.
  add-member --workspace <id> --email <email> --role <${ROLES.join("|")}>
                                                            Makes a signed-in person a member of the workspace. It refuses a person who is already a member and never changes a role.
  rename-workspace --workspace <id> [--name <name>] [--short-name <short name>]
                                                            Changes the workspace's name, its short name, or both. Give at least one. The other stays as it is.
  set-model-key --workspace <id> --provider <${MODEL_PROVIDERS.join("|")}>
                                                            Reads the workspace's key for that model provider from stdin and stores it encrypted. It never prints the key. A second run replaces it.
  set-spending-limit --workspace <id> --gbp <pounds>        Sets the most the workspace's model calls may spend each calendar month. A second run replaces it. With no limit set, no model is called.
  set-model-choice --workspace <id> --purpose <${CHOSEN_PURPOSES.join("|")}> --provider <${[...CHOOSABLE_PROVIDERS].join("|")}> --model <model>
                                                            Sets the model the workspace calls for that purpose. The model needs a price, and its provider must be a sub-processor the DPIA names. A second run replaces it.
  set-model-price --provider <${MODEL_PROVIDERS.join("|")}> --model <model> --from <yyyy-mm-dd> --gbp-per-million-in <pounds> --gbp-per-million-out <pounds>
                                                            Sets what a model costs from that day on, per million tokens sent and per million returned. A model with no price is never called.
  set-decision-threshold --provider <${DECISION_PROVIDERS.join("|")}> --model <model> --threshold <probability>
                                                            Sets the probability at or above which a decision model's yes counts. A second run replaces it. A model with no threshold makes no decisions.
  operator --email <email> --grant|--revoke                 Makes a signed-in person the platform operator, or removes them. Each change is written to the identity-set audit log.
  restore-sign-in --email <email>                           For a person who lost every factor and recovery code: ends their factors and sessions, emails them a notice, and prints a one-time restore code. Confirm who they are another way first.
  import-bundle --workspace <id> --from <directory> --as <member email> [--sensitivity <sensitivity>] [--dry-run]
                                                            Writes the company's bundle through the governed write, imports its verifications, and rewrites its links to IRIs.
    --sensitivity  The sensitivity of the imported concepts: ${SENSITIVITIES.join(", ")} (default ${IMPORT_SENSITIVITY_DEFAULT}).
    --dry-run      Checks the tree and prints what a run would do, without writing anything.
  update-concept-body --workspace <id> --iri <iri> --as <member email> [--expect <content hash>] [--dry-run]
                                                            Replaces the concept's body with the one on stdin. It keeps the frontmatter, status, verification and citations.
    --expect   The concept's current content hash. A write needs it, and a dry run prints it.
    --dry-run  Prints the concept's current content hash and the diff of its body, without writing anything.
exit codes:
  ${DONE} The command finished.
  ${REFUSED} The command refused with no refusal word. Stop and read the output.
  ${USAGE} The command or an argument is wrong.
  ${NOT_BUILT} This database does not have the tables the command needs yet.
  A refusal word exits with the code of its class: ${Object.entries(EXIT_OF_CLASS)
    .map(([refusalClass, code]) => `${code} ${refusalClass}`)
    .join(", ")}.
  A run that stops at a named file or commit exits ${REFUSED}, whatever refusal word it prints. These runs are import-bundle with an unsound tree or a stopped import, and reconcile-watermark with a stopped replay.
  An import whose manifest commit is refused as malformed also exits ${REFUSED}, because only a defect in the import can cause that refusal.`;

const notBuiltSaid = async (doors: Doors, command: SliceCommand): Promise<string | undefined> => {
  const tables: readonly Table[] = NEEDS[command];
  const needed = tables.map((table) => getTableName(table));
  const present = await tablesPresent(doors.postgres, needed);
  return present.length < needed.length
    ? `${command}: not built — the database is missing these tables: ${needed.filter((name) => !present.includes(name)).join(", ")}. Run the migrations that create them.`
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
  ["refold-concept-types", inWorkspaceAloneOf(refoldConceptTypesCommand)],
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
