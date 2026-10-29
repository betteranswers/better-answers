import { describe, expect, it } from "vitest";

import { matching } from "@better-answers/schema/testing/matching";

import { parseOpsArgs, SLICE_COMMANDS } from "../../src/ops/index.ts";

const WORKSPACE = "01K5ZQ8WJ6T3M4N7P9R2S0V1X0";

const USAGE_LISTING = matching.stringMatching(
  /^usage: pnpm ops <command> \[options\]\n {2}replay-erasures /u,
);

const UNKNOWN_BEFORE_LISTING = (command: string) =>
  matching.stringMatching(
    new RegExp(`^unknown command: ${command}\\nusage: pnpm ops <command> \\[options\\]\\n`, "u"),
  );

const without = (flags: readonly string[], flag: string): readonly string[] => {
  const at = flags.indexOf(flag);
  return [...flags.slice(0, at), ...flags.slice(at + 2)];
};

const parsed = (argv: readonly string[]) => {
  const result = parseOpsArgs(argv);
  return result.ok
    ? { name: result.value.name, asked: result.value.asked }
    : { refusal: result.error };
};

describe("pnpm ops — the command line, parsed before anything runs", () => {
  describe("the dispatch rules", () => {
    it("refuses no command with the usage text", () => {
      expect(parsed([])).toEqual({ refusal: USAGE_LISTING });
    });

    it("names an unknown command above the usage text", () => {
      expect(parsed(["make-it-so"])).toEqual({ refusal: UNKNOWN_BEFORE_LISTING("make-it-so") });
    });

    it.each(["toString", "__proto__"])(
      "answers %s, a name every object inherits, as unknown",
      (command) => {
        expect(parsed([command, "--workspace", WORKSPACE])).toEqual({
          refusal: UNKNOWN_BEFORE_LISTING(command),
        });
      },
    );

    it("skips one leading -- and no other, as pnpm's separator", () => {
      expect(parsed(["--", "map-counts", "--workspace", WORKSPACE])).toEqual({
        name: "map-counts",
        asked: { workspaceId: WORKSPACE },
      });
      expect(parsed(["--", "--help"])).toEqual({ name: "help", asked: {} });
      expect(parsed(["--"])).toEqual({ refusal: USAGE_LISTING });
      expect(parsed(["--", "--"])).toEqual({ refusal: UNKNOWN_BEFORE_LISTING("--") });
    });

    it.each(["help", "--help"])("reads %s as the help command, flags and all", (word) => {
      expect(parsed([word])).toEqual({ name: "help", asked: {} });
      expect(parsed([word, "--workspace", WORKSPACE])).toEqual({ name: "help", asked: {} });
    });

    it.each(SLICE_COMMANDS)("%s needs --workspace, asked ahead of its own flags", (command) => {
      const refusal = `${command}: --workspace <id> is required`;

      expect(parsed([command])).toEqual({ refusal });
      expect(parsed([command, "--workspace"])).toEqual({ refusal });
      expect(parsed([command, "--workspace", "--reason", "upgrade"])).toEqual({ refusal });
    });

    it("takes the workspace as typed, judging no id", () => {
      expect(parsed(["map-counts", "--workspace", "ws_synthetic"])).toEqual({
        name: "map-counts",
        asked: { workspaceId: "ws_synthetic" },
      });
    });

    it("drops words that name no flag", () => {
      expect(parsed(["map-counts", "stray", "--workspace", WORKSPACE, "words"])).toEqual({
        name: "map-counts",
        asked: { workspaceId: WORKSPACE },
      });
    });
  });

  describe("map-rebuild", () => {
    it("defaults to a drill's rebuild, waiting for nothing", () => {
      expect(parsed(["map-rebuild", "--workspace", WORKSPACE])).toEqual({
        name: "map-rebuild",
        asked: { workspaceId: WORKSPACE, reason: "drill", wait: undefined },
      });
    });

    it.each(["first-build", "model-choice-change", "reconciler", "erasure", "upgrade", "drill"])(
      "takes the reason %s",
      (reason) => {
        expect(parsed(["map-rebuild", "--workspace", WORKSPACE, "--reason", reason])).toEqual({
          name: "map-rebuild",
          asked: { workspaceId: WORKSPACE, reason, wait: undefined },
        });
      },
    );

    it("answers usage to a reason outside the six", () => {
      expect(
        parsed(["map-rebuild", "--workspace", WORKSPACE, "--reason", "because-i-said-so"]),
      ).toEqual({
        refusal:
          "map-rebuild: --reason must be one of first-build, model-choice-change, reconciler, erasure, upgrade, drill",
      });
    });

    it("waits 120 seconds for a bare --wait", () => {
      expect(parsed(["map-rebuild", "--workspace", WORKSPACE, "--wait"])).toEqual({
        name: "map-rebuild",
        asked: { workspaceId: WORKSPACE, reason: "drill", wait: 120 },
      });
    });

    it("waits the whole seconds --wait-seconds names", () => {
      expect(parsed(["map-rebuild", "--workspace", WORKSPACE, "--wait-seconds", "30"])).toEqual({
        name: "map-rebuild",
        asked: { workspaceId: WORKSPACE, reason: "drill", wait: 30 },
      });
    });

    it("lets --wait-seconds name the seconds beside a bare --wait", () => {
      expect(
        parsed(["map-rebuild", "--workspace", WORKSPACE, "--wait", "--wait-seconds", "7"]),
      ).toEqual({
        name: "map-rebuild",
        asked: { workspaceId: WORKSPACE, reason: "drill", wait: 7 },
      });
    });

    it.each([
      ["a --wait carrying a value", ["--wait", "soon"]],
      [
        "a --wait carrying a value beside --wait-seconds",
        ["--wait", "soon", "--wait-seconds", "30"],
      ],
      ["a non-numeric --wait-seconds", ["--wait-seconds", "soon"]],
      ["a --wait-seconds of zero", ["--wait-seconds", "0"]],
      ["a negative --wait-seconds", ["--wait-seconds", "-5"]],
      ["a fractional --wait-seconds", ["--wait-seconds", "1.5"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["map-rebuild", "--workspace", WORKSPACE, ...flags])).toEqual({
        refusal:
          "map-rebuild: --wait takes no value; --wait-seconds takes a whole number of seconds",
      });
    });

    it("judges the reason before the wait", () => {
      expect(
        parsed(["map-rebuild", "--workspace", WORKSPACE, "--reason", "nope", "--wait", "soon"]),
      ).toEqual({
        refusal:
          "map-rebuild: --reason must be one of first-build, model-choice-change, reconciler, erasure, upgrade, drill",
      });
    });
  });

  describe("the commands that take a workspace alone", () => {
    it.each([
      "map-sweep",
      "map-counts",
      "unmapped-passage-rate",
      "reconcile-watermark",
      "reindex-connected-sources",
    ])("%s asks for the workspace and nothing else", (command) => {
      expect(parsed([command, "--workspace", WORKSPACE, "--wait"])).toEqual({
        name: command,
        asked: { workspaceId: WORKSPACE },
      });
    });
  });

  describe("object-store-orphans", () => {
    it("removes by default and lists with --list", () => {
      expect(parsed(["object-store-orphans", "--workspace", WORKSPACE])).toEqual({
        name: "object-store-orphans",
        asked: { workspaceId: WORKSPACE, list: false },
      });
      expect(parsed(["object-store-orphans", "--workspace", WORKSPACE, "--list"])).toEqual({
        name: "object-store-orphans",
        asked: { workspaceId: WORKSPACE, list: true },
      });
      expect(parsed(["object-store-orphans", "--list", "--workspace", WORKSPACE])).toEqual({
        name: "object-store-orphans",
        asked: { workspaceId: WORKSPACE, list: true },
      });
    });

    it("answers usage to a --list carrying a value", () => {
      expect(parsed(["object-store-orphans", "--workspace", WORKSPACE, "--list", "now"])).toEqual({
        refusal: "object-store-orphans: --list takes no value",
      });
    });
  });

  describe("replay-erasures", () => {
    it.each([
      ["a dump stamp", "20260904T020500Z", "2026-09-04T02:05:00.000Z"],
      ["an ISO instant", "2026-09-03T02:05:00Z", "2026-09-03T02:05:00.000Z"],
    ])("reads --since as %s", (_shape, since, instant) => {
      expect(parsed(["replay-erasures", "--since", since])).toEqual({
        name: "replay-erasures",
        asked: { since: new Date(instant) },
      });
    });

    it.each([
      ["no --since", []],
      ["a bare --since", ["--since"]],
      ["a --since that is no instant", ["--since", "yesterday"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["replay-erasures", ...flags])).toEqual({
        refusal: "replay-erasures: --since <dump stamp or ISO instant> is required",
      });
    });
  });

  describe("erasure-rehearsal", () => {
    const SYNTHETIC_MISSING =
      "erasure-rehearsal: --synthetic is required — this command creates a synthetic subject and then erases them, and the flag is the caller saying this workspace is somewhere that may happen";

    const PHASE_MISSING =
      "erasure-rehearsal: exactly one of --seed (phase one) or --run --report <file> (phase two); the drill takes a dump between them";

    const REPORT_MISSING =
      "erasure-rehearsal: --run needs --report <file> — the report is what the drill keeps, and a run whose report went nowhere proved nothing";

    const WAIT_MALFORMED = "erasure-rehearsal: --wait-seconds takes a whole number of seconds";

    it("seeds, waiting 120 seconds for the index job by default", () => {
      expect(
        parsed(["erasure-rehearsal", "--workspace", WORKSPACE, "--synthetic", "--seed"]),
      ).toEqual({
        name: "erasure-rehearsal",
        asked: { workspaceId: WORKSPACE, phase: "seed", waitSeconds: 120 },
      });
    });

    it.each([
      ["a bare --wait", ["--wait"], 120],
      ["--wait-seconds 5", ["--wait-seconds", "5"], 5],
    ])("seeds, waiting for %s", (_shape, wait, waitSeconds) => {
      expect(
        parsed(["erasure-rehearsal", "--workspace", WORKSPACE, "--synthetic", "--seed", ...wait]),
      ).toEqual({
        name: "erasure-rehearsal",
        asked: { workspaceId: WORKSPACE, phase: "seed", waitSeconds },
      });
    });

    it("runs, writing the report where it is told", () => {
      expect(
        parsed([
          "erasure-rehearsal",
          "--workspace",
          WORKSPACE,
          "--synthetic",
          "--run",
          "--report",
          "report.md",
        ]),
      ).toEqual({
        name: "erasure-rehearsal",
        asked: { workspaceId: WORKSPACE, phase: "run", reportPath: "report.md" },
      });
    });

    it("leaves a wait out of a run", () => {
      expect(
        parsed([
          "erasure-rehearsal",
          "--workspace",
          WORKSPACE,
          "--synthetic",
          "--run",
          "--report",
          "report.md",
          "--wait-seconds",
          "5",
        ]),
      ).toEqual({
        name: "erasure-rehearsal",
        asked: { workspaceId: WORKSPACE, phase: "run", reportPath: "report.md" },
      });
    });

    it("leaves a report out of a seed", () => {
      expect(
        parsed([
          "erasure-rehearsal",
          "--workspace",
          WORKSPACE,
          "--synthetic",
          "--seed",
          "--report",
          "report.md",
        ]),
      ).toEqual({
        name: "erasure-rehearsal",
        asked: { workspaceId: WORKSPACE, phase: "seed", waitSeconds: 120 },
      });
    });

    it.each([
      ["--seed", []],
      ["--run", ["--report", "report.md"]],
    ])("answers usage to %s with a wait not in seconds", (phase, report) => {
      expect(
        parsed([
          "erasure-rehearsal",
          "--workspace",
          WORKSPACE,
          "--synthetic",
          phase,
          ...report,
          "--wait-seconds",
          "a minute",
        ]),
      ).toEqual({ refusal: WAIT_MALFORMED });
    });

    it("answers usage without --synthetic, the caller's consent to run here", () => {
      expect(parsed(["erasure-rehearsal", "--workspace", WORKSPACE, "--seed"])).toEqual({
        refusal: SYNTHETIC_MISSING,
      });
      expect(
        parsed(["erasure-rehearsal", "--workspace", WORKSPACE, "--synthetic", "yes", "--seed"]),
      ).toEqual({ refusal: SYNTHETIC_MISSING });
    });

    it("answers usage to neither or both phases at once", () => {
      const neither = ["erasure-rehearsal", "--workspace", WORKSPACE, "--synthetic"];

      expect(parsed([...neither, "--seed", "--run"])).toEqual({ refusal: PHASE_MISSING });
      expect(parsed(neither)).toEqual({ refusal: PHASE_MISSING });
      expect(parsed([...neither, "--seed", "now"])).toEqual({ refusal: PHASE_MISSING });
    });

    it("answers usage to a reportless run, which would prove nothing", () => {
      const running = ["erasure-rehearsal", "--workspace", WORKSPACE, "--synthetic", "--run"];

      expect(parsed(running)).toEqual({ refusal: REPORT_MISSING });
      expect(parsed([...running, "--report"])).toEqual({ refusal: REPORT_MISSING });
    });

    it("judges consent, phase, report and wait in that order", () => {
      const asking = ["erasure-rehearsal", "--workspace", WORKSPACE];

      expect(parsed([...asking, "--wait-seconds", "x"])).toEqual({ refusal: SYNTHETIC_MISSING });
      expect(parsed([...asking, "--synthetic", "--wait-seconds", "x"])).toEqual({
        refusal: PHASE_MISSING,
      });
      expect(parsed([...asking, "--synthetic", "--run", "--wait-seconds", "x"])).toEqual({
        refusal: REPORT_MISSING,
      });
    });
  });

  describe("import-bundle", () => {
    const FLAGS = ["--from", "/tmp/bundle", "--as", "a@b.c"];

    const REQUIRED = "import-bundle: --from <directory> and --as <member email> are required";

    it("lands as Internal and for real by default", () => {
      expect(parsed(["import-bundle", "--workspace", WORKSPACE, ...FLAGS])).toEqual({
        name: "import-bundle",
        asked: {
          workspaceId: WORKSPACE,
          from: "/tmp/bundle",
          email: "a@b.c",
          sensitivity: "Internal",
          dryRun: false,
        },
      });
    });

    it.each(["Restricted", "Internal", "Public"])("lands at the class %s", (sensitivity) => {
      expect(
        parsed(["import-bundle", "--workspace", WORKSPACE, ...FLAGS, "--sensitivity", sensitivity]),
      ).toEqual({
        name: "import-bundle",
        asked: {
          workspaceId: WORKSPACE,
          from: "/tmp/bundle",
          email: "a@b.c",
          sensitivity,
          dryRun: false,
        },
      });
    });

    it("runs dry with a bare --dry-run", () => {
      expect(parsed(["import-bundle", "--workspace", WORKSPACE, ...FLAGS, "--dry-run"])).toEqual({
        name: "import-bundle",
        asked: {
          workspaceId: WORKSPACE,
          from: "/tmp/bundle",
          email: "a@b.c",
          sensitivity: "Internal",
          dryRun: true,
        },
      });
    });

    it.each([
      ["no --from or --as", [], REQUIRED],
      ["no --from", ["--as", "a@b.c"], REQUIRED],
      ["no --as", ["--from", "/tmp/bundle"], REQUIRED],
      [
        "an unknown sensitivity",
        [...FLAGS, "--sensitivity", "Secret"],
        "import-bundle: --sensitivity must be one of Restricted, Internal, Public",
      ],
      [
        "an unknown sensitivity beside no --as",
        ["--from", "/tmp/bundle", "--sensitivity", "Secret"],
        REQUIRED,
      ],
      [
        "a --dry-run carrying a value",
        [...FLAGS, "--dry-run", "yes"],
        "import-bundle: --dry-run takes no value",
      ],
      [
        "a --dry-run value beside a bad sensitivity",
        [...FLAGS, "--sensitivity", "Secret", "--dry-run", "yes"],
        "import-bundle: --sensitivity must be one of Restricted, Internal, Public",
      ],
    ])("answers usage to %s", (_shape, flags, refusal) => {
      expect(parsed(["import-bundle", "--workspace", WORKSPACE, ...flags])).toEqual({ refusal });
    });
  });

  describe("update-concept-body", () => {
    const IRI = "https://acme.invalid/c/x";

    const FLAGS = ["--iri", IRI, "--as", "a@b.c"];

    const REQUIRED =
      "update-concept-body: --iri <iri> and --as <member email> are required, with the new body on stdin";

    it("writes against the hash it expects", () => {
      expect(
        parsed(["update-concept-body", "--workspace", WORKSPACE, ...FLAGS, "--expect", "h1"]),
      ).toEqual({
        name: "update-concept-body",
        asked: {
          workspaceId: WORKSPACE,
          iri: IRI,
          email: "a@b.c",
          run: { dryRun: false, base: "h1" },
        },
      });
    });

    it("runs dry without a hash, and with one", () => {
      expect(
        parsed(["update-concept-body", "--workspace", WORKSPACE, ...FLAGS, "--dry-run"]),
      ).toEqual({
        name: "update-concept-body",
        asked: {
          workspaceId: WORKSPACE,
          iri: IRI,
          email: "a@b.c",
          run: { dryRun: true, base: undefined },
        },
      });
      expect(
        parsed([
          "update-concept-body",
          "--workspace",
          WORKSPACE,
          ...FLAGS,
          "--dry-run",
          "--expect",
          "h1",
        ]),
      ).toEqual({
        name: "update-concept-body",
        asked: {
          workspaceId: WORKSPACE,
          iri: IRI,
          email: "a@b.c",
          run: { dryRun: true, base: "h1" },
        },
      });
    });

    it.each([
      ["no --iri or --as", [], REQUIRED],
      ["no --iri", ["--as", "a@b.c", "--expect", "h1"], REQUIRED],
      ["no --as", ["--iri", IRI, "--expect", "h1"], REQUIRED],
      [
        "a write with no --expect",
        FLAGS,
        "update-concept-body: --expect <content hash> is required on a write; run with --dry-run to read the hash the concept stands at",
      ],
      [
        "a --dry-run carrying a value",
        [...FLAGS, "--dry-run", "yes"],
        "update-concept-body: --dry-run takes no value",
      ],
      ["a --dry-run value beside no --iri", ["--as", "a@b.c", "--dry-run", "yes"], REQUIRED],
    ])("answers usage to %s", (_shape, flags, refusal) => {
      expect(parsed(["update-concept-body", "--workspace", WORKSPACE, ...flags])).toEqual({
        refusal,
      });
    });
  });

  describe("set-model-key", () => {
    it("takes the provider as typed, judging no word", () => {
      expect(
        parsed(["set-model-key", "--workspace", WORKSPACE, "--provider", "anthropic"]),
      ).toEqual({
        name: "set-model-key",
        asked: { workspaceId: WORKSPACE, provider: "anthropic" },
      });
    });

    it("answers usage with no --provider", () => {
      const refusal =
        "set-model-key: --workspace <id> and --provider <anthropic|mistral|cloudflare> are required, with the key on standard input";

      expect(parsed(["set-model-key", "--workspace", WORKSPACE])).toEqual({ refusal });
      expect(parsed(["set-model-key", "--workspace", WORKSPACE, "--provider"])).toEqual({
        refusal,
      });
    });
  });

  describe("set-spending-limit", () => {
    it("takes the sum as typed, judging no pounds", () => {
      expect(parsed(["set-spending-limit", "--workspace", WORKSPACE, "--gbp", "12.50"])).toEqual({
        name: "set-spending-limit",
        asked: { workspaceId: WORKSPACE, gbp: "12.50" },
      });
    });

    it("answers usage with no --gbp", () => {
      expect(parsed(["set-spending-limit", "--workspace", WORKSPACE])).toEqual({
        refusal: "set-spending-limit: --workspace <id> and --gbp <pounds a month> are required",
      });
    });
  });

  describe("set-model-choice", () => {
    const FLAGS = ["--purpose", "judging", "--provider", "anthropic", "--model", "claude-sonnet"];

    it("takes the purpose, provider and model as typed", () => {
      expect(parsed(["set-model-choice", "--workspace", WORKSPACE, ...FLAGS])).toEqual({
        name: "set-model-choice",
        asked: {
          workspaceId: WORKSPACE,
          purpose: "judging",
          provider: "anthropic",
          model: "claude-sonnet",
        },
      });
    });

    it.each(["--purpose", "--provider", "--model"])("answers usage without %s", (flag) => {
      expect(
        parsed(["set-model-choice", "--workspace", WORKSPACE, ...without(FLAGS, flag)]),
      ).toEqual({
        refusal:
          "set-model-choice: --workspace <id>, --purpose <extraction|enrichment|answering|judging>, --provider <provider> and --model <model> are required",
      });
    });
  });

  describe("set-model-price", () => {
    const FLAGS = [
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet",
      "--from",
      "2026-10-14",
      "--gbp-per-million-in",
      "2.5",
      "--gbp-per-million-out",
      "12",
    ];

    it("reads --from as the price's effective date", () => {
      expect(parsed(["set-model-price", ...FLAGS])).toEqual({
        name: "set-model-price",
        asked: {
          provider: "anthropic",
          model: "claude-sonnet",
          effectiveFrom: "2026-10-14",
          gbpPerMillionIn: "2.5",
          gbpPerMillionOut: "12",
        },
      });
    });

    it.each(["--provider", "--model", "--from", "--gbp-per-million-in", "--gbp-per-million-out"])(
      "answers usage without %s",
      (flag) => {
        expect(parsed(["set-model-price", ...without(FLAGS, flag)])).toEqual({
          refusal:
            "set-model-price: --provider <anthropic|mistral|cloudflare>, --model <model>, --from <yyyy-mm-dd>, --gbp-per-million-in <pounds> and --gbp-per-million-out <pounds> are required",
        });
      },
    );
  });

  describe("set-decision-threshold", () => {
    const FLAGS = ["--provider", "cloudflare", "--model", "bge-small", "--threshold", "0.7"];

    it("takes the provider, model and threshold as typed", () => {
      expect(parsed(["set-decision-threshold", ...FLAGS])).toEqual({
        name: "set-decision-threshold",
        asked: { provider: "cloudflare", model: "bge-small", threshold: "0.7" },
      });
    });

    it.each(["--provider", "--model", "--threshold"])("answers usage without %s", (flag) => {
      expect(parsed(["set-decision-threshold", ...without(FLAGS, flag)])).toEqual({
        refusal:
          "set-decision-threshold: --provider <cloudflare>, --model <model> and --threshold <probability> are required",
      });
    });
  });

  describe("provision-workspace", () => {
    it("takes the name, short name and Admin as typed", () => {
      expect(
        parsed([
          "provision-workspace",
          "--name",
          "Acme",
          "--short-name",
          "acme",
          "--admin",
          "a@b.c",
        ]),
      ).toEqual({
        name: "provision-workspace",
        asked: { name: "Acme", shortName: "acme", admin: "a@b.c" },
      });
    });

    it.each([
      ["no flags at all", []],
      ["no --admin", ["--name", "Acme", "--short-name", "acme"]],
      ["no --short-name", ["--name", "Acme", "--admin", "a@b.c"]],
      ["no --name", ["--short-name", "acme", "--admin", "a@b.c"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["provision-workspace", ...flags])).toEqual({
        refusal:
          "provision-workspace: --name <name>, --short-name <short name> and --admin <email> are required",
      });
    });
  });

  describe("add-person", () => {
    it("takes the email and display name as typed", () => {
      expect(
        parsed(["add-person", "--email", "matthew@phew.invalid", "--name", "Matthew Burgess"]),
      ).toEqual({
        name: "add-person",
        asked: { email: "matthew@phew.invalid", name: "Matthew Burgess" },
      });
    });

    it.each([
      ["no --name", ["--email", "matthew@phew.invalid"]],
      ["no --email", ["--name", "Matthew Burgess"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["add-person", ...flags])).toEqual({
        refusal: "add-person: --email <address> and --name <display name> are required",
      });
    });
  });

  describe("add-member", () => {
    const REQUIRED =
      "add-member: --workspace <id>, --email <email> and --role <Admin|Editor|Viewer> are required";

    it.each(["Admin", "Editor", "Viewer"])("takes the role %s", (role) => {
      expect(
        parsed(["add-member", "--workspace", WORKSPACE, "--email", "a@b.c", "--role", role]),
      ).toEqual({
        name: "add-member",
        asked: { workspaceId: WORKSPACE, email: "a@b.c", role },
      });
    });

    it.each(["Owner", "admin"])("answers usage to the role word %s", (role) => {
      expect(
        parsed(["add-member", "--workspace", WORKSPACE, "--email", "a@b.c", "--role", role]),
      ).toEqual({ refusal: "add-member: --role must be one of Admin, Editor, Viewer" });
    });

    it.each([
      ["no flags at all", []],
      ["no --workspace", ["--email", "a@b.c", "--role", "Editor"]],
      ["no --email", ["--workspace", WORKSPACE, "--role", "Editor"]],
      ["no --role", ["--workspace", WORKSPACE, "--email", "a@b.c"]],
      ["an unknown role beside no --email", ["--workspace", WORKSPACE, "--role", "Owner"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["add-member", ...flags])).toEqual({ refusal: REQUIRED });
    });
  });

  describe("rename-workspace", () => {
    it.each([
      ["a name", ["--name", "Acme Group"], { name: "Acme Group", shortName: undefined }],
      [
        "a short name",
        ["--short-name", "acme-group"],
        { name: undefined, shortName: "acme-group" },
      ],
      [
        "both",
        ["--name", "Acme Group", "--short-name", "acme-group"],
        { name: "Acme Group", shortName: "acme-group" },
      ],
      ["neither, which the store refuses", [], { name: undefined, shortName: undefined }],
    ])("renames to %s", (_shape, flags, renamed) => {
      expect(parsed(["rename-workspace", "--workspace", WORKSPACE, ...flags])).toEqual({
        name: "rename-workspace",
        asked: { workspaceId: WORKSPACE, ...renamed },
      });
    });

    it.each([
      ["no flags at all", []],
      ["no --workspace", ["--name", "Acme Group", "--short-name", "acme"]],
      ["a bare --workspace", ["--workspace", "--name", "Acme Group"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["rename-workspace", ...flags])).toEqual({
        refusal:
          "rename-workspace: --workspace <id> is required, with --name <name>, --short-name <short name> or both",
      });
    });
  });

  describe("operator", () => {
    it.each([
      ["--grant", "grant"],
      ["--revoke", "revoke"],
    ])("reads %s as the change %s", (flag, change) => {
      expect(parsed(["operator", "--email", "a@b.c", flag])).toEqual({
        name: "operator",
        asked: { email: "a@b.c", change },
      });
      expect(parsed(["operator", flag, "--email", "a@b.c"])).toEqual({
        name: "operator",
        asked: { email: "a@b.c", change },
      });
    });

    it.each([
      ["neither --grant nor --revoke", ["--email", "a@b.c"]],
      ["both --grant and --revoke", ["--email", "a@b.c", "--grant", "--revoke"]],
      ["no --email", ["--grant"]],
      ["no --email beside --revoke", ["--revoke"]],
      ["a bare --email", ["--email", "--grant"]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["operator", ...flags])).toEqual({
        refusal: "operator: --email <email> and one of --grant or --revoke are required",
      });
    });
  });

  describe("restore-sign-in", () => {
    it("takes the email as typed", () => {
      expect(parsed(["restore-sign-in", "--email", "a@b.c"])).toEqual({
        name: "restore-sign-in",
        asked: { email: "a@b.c" },
      });
    });

    it("answers usage without --email", () => {
      const refusal = "restore-sign-in: --email <email> is required";

      expect(parsed(["restore-sign-in"])).toEqual({ refusal });
      expect(parsed(["restore-sign-in", "--email"])).toEqual({ refusal });
    });
  });

  describe("smoke", () => {
    const ORIGIN = "http://127.0.0.1:3000";

    it("notes nothing by hand unless told to", () => {
      expect(parsed(["smoke", "--url", ORIGIN])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: [] },
      });
    });

    it("notes by hand in a fixed order, whatever the typing", () => {
      expect(parsed(["smoke", "--url", ORIGIN, "--find", "--guide", "--ask"])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: ["find", "guide", "ask"] },
      });
      expect(parsed(["smoke", "--ask", "--url", ORIGIN, "--find"])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: ["find", "ask"] },
      });
      expect(parsed(["smoke", "--url", ORIGIN, "--guide"])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: ["guide"] },
      });
    });

    it("reads a --find carrying a value as no note", () => {
      expect(parsed(["smoke", "--url", ORIGIN, "--find", "yes"])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: [] },
      });
    });

    it("ignores the --workspace its usage allows", () => {
      expect(parsed(["smoke", "--url", ORIGIN, "--workspace", WORKSPACE])).toEqual({
        name: "smoke",
        asked: { url: ORIGIN, byHand: [] },
      });
    });

    it("answers usage without --url", () => {
      const refusal = "smoke: --url <origin> is required (http://127.0.0.1:3000 inside the stack)";

      expect(parsed(["smoke"])).toEqual({ refusal });
      expect(parsed(["smoke", "--url"])).toEqual({ refusal });
    });
  });

  describe("dump-grep", () => {
    it("splits --tokens at its commas", () => {
      expect(parsed(["dump-grep", "--tokens", "jane@example.test,nobody@example.test"])).toEqual({
        name: "dump-grep",
        asked: { tokens: ["jane@example.test", "nobody@example.test"] },
      });
    });

    it("trims tokens, drops empty ones, keeps each once", () => {
      expect(parsed(["dump-grep", "--tokens", " b , a ,, b ,"])).toEqual({
        name: "dump-grep",
        asked: { tokens: ["b", "a"] },
      });
    });

    it.each([
      ["no --tokens", []],
      ["a bare --tokens", ["--tokens"]],
      ["a --tokens of commas", ["--tokens", ",,"]],
      ["a --tokens of spaces", ["--tokens", " , "]],
    ])("answers usage to %s", (_shape, flags) => {
      expect(parsed(["dump-grep", ...flags])).toEqual({
        refusal: "dump-grep: --tokens <a,b,…> is required",
      });
    });
  });
});
