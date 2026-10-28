// Plan 009's static estimate of the infrastructure each test file reaches, read from its
// import closure. Usage: node classify.mjs <repository root>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.argv[2] ?? ".";

/** The workspace `testing` subpath exports at `f59a9da35`. A path plan 008 moves is added here. */
const TESTING_EXPORTS = {
  "@better-answers/core/testing/postgres": "packages/core/test/suite-postgres.ts",
  "@better-answers/core/testing/objects": "packages/core/test/suite-objects.ts",
  "@better-answers/core/testing/warm-objects": "packages/core/test/warm-objects.ts",
  "@better-answers/core/testing/bundle": "packages/core/test/bundle.ts",
  "@better-answers/core/testing/bundle-root": "packages/core/test/bundle-root.ts",
  "@better-answers/core/testing/documents": "packages/core/test/suite-documents.ts",
  "@better-answers/core/testing/worker-process": "packages/core/test/worker-process.ts",
  "@better-answers/core/testing/cross-tier": "packages/core/test/cross-tier-fixture.ts",
  "@better-answers/core/testing/identity-rows": "packages/core/test/identity-rows.ts",
  "@better-answers/core/testing/input": "packages/core/test/suite-input.ts",
  "@better-answers/schema/testing": "packages/schema/test/testing.ts",
  "@better-answers/schema/testing/warm-postgres": "packages/schema/test/warm-postgres.ts",
};

const MARKERS = {
  postgres:
    /\b(postgresForSuite|postgresForEachCase|openMigratedPostgres|startTestDatabase|clonedFrom|migrated_postgres|migrated_postgres_at|PostgreSqlContainer|apply_journal)\b/u,
  objects: /\b(objectStoreForSuite|openObjectStore|garage|Garage)\b/u,
  git: /\b(bundlesForSuite|openTestGit|gitStoreDir|openGitDoor|write_bundle|["']git["']\s*,|execFile\(\s*["']git)/u,
  docker:
    /\b(startTheImage|readTheImage|buildCommand|docker\s+(build|run|compose)|["']docker["']|runScript|IMAGE_PROBE)\b/u,
  workerProcess: /\b(runWorkerOnce|uv run|spawn\(\s*["']uv)/u,
  browser: /\b(@playwright\/test|chromium)\b/u,
};

const WORKSPACES = [
  "apps/api",
  "apps/web",
  "apps/worker",
  "packages/core",
  "packages/devtools",
  "packages/schema",
];

/** Each file lands in the first tier its closure reaches, in this order. */
const TIERS = [
  ["browser", "Browser"],
  ["docker", "Docker image"],
  ["workerProcess", "Worker process"],
  ["postgres", "Postgres"],
  ["objects", "Object store only"],
  ["git", "Git only"],
];

const IN_PROCESS = "In-process";

const isTest = (file) => /(\.test\.(ts|tsx|mjs)|\.spec\.ts|\/test_[^/]*\.py)$/u.test(file);

const isBrowserSpec = (file) => /\/e2e\/.*\.spec\.ts$/u.test(file);

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("."))
      return [];
    const at = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(at) : [at];
  });

const resolvedImport = (from, specifier) => {
  if (!specifier.startsWith(".")) {
    const exported = TESTING_EXPORTS[specifier];
    return exported === undefined ? undefined : join(root, exported);
  }
  const base = resolve(dirname(from), specifier);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/u, ".ts"),
    join(base, "index.ts"),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

const pythonImports = (file, source) =>
  [...source.matchAll(/^from (?:tests\.)?(\w+) import|^import (?:tests\.)?(\w+)/gmu)]
    .map((match) => join(dirname(file), `${match[1] ?? match[2]}.py`))
    .filter((candidate) => existsSync(candidate));

const read = new Map();

const ownMarkersAndImports = (file) => {
  const known = read.get(file);
  if (known !== undefined) return known;
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const markers = Object.keys(MARKERS).filter((marker) => MARKERS[marker].test(source));
  const imports = [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/gu)]
    .map((match) => resolvedImport(file, match[1]))
    .filter((resolved) => resolved !== undefined);
  if (file.endsWith(".py")) imports.push(...pythonImports(file, source));
  const own = { markers, imports };
  read.set(file, own);
  return own;
};

/** @param {string} file @returns {string[]} */
const reached = (file) => {
  const seen = new Set();
  const markers = new Set(isBrowserSpec(file) ? ["browser"] : []);
  const pending = [file];
  while (pending.length > 0) {
    const next = pending.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    const own = ownMarkersAndImports(next);
    for (const marker of own.markers) markers.add(marker);
    pending.push(...own.imports);
  }
  return [...markers].sort((a, b) => a.localeCompare(b));
};

/** @param {readonly string[]} markers */
const tierOf = (markers) => TIERS.find(([marker]) => markers.includes(marker))?.[1] ?? IN_PROCESS;

/** @typedef {{ workspace: string, file: string, markers: string[], tier: string }} Row */

/** @type {Row[]} */
const classified = WORKSPACES.flatMap((workspace) =>
  filesUnder(join(root, workspace))
    .filter(isTest)
    .map((file) => {
      const markers = reached(file);
      return { workspace, file: relative(root, file), markers, tier: tierOf(markers) };
    }),
);

const columns = [
  IN_PROCESS,
  "Postgres",
  "Object store only",
  "Git only",
  "Worker process",
  "Docker image",
  "Browser",
];

/** @param {readonly Row[]} rows @param {string} column */
const countIn = (rows, column) => rows.filter((row) => row.tier === column).length;

/** @param {readonly (string | number)[]} cells */
const line = (cells) => `| ${cells.join(" | ")} |`;

const inProcess = countIn(classified, IN_PROCESS);
const share = Math.round((100 * inProcess) / classified.length);

/** @param {string} marker */
const reaching = (marker) => classified.filter((row) => row.markers.includes(marker));

const postgres = reaching("postgres");

const report = [
  line(["Workspace", ...columns]),
  line(["---", ...columns.map(() => "---")]),
  ...WORKSPACES.map((workspace) => {
    const rows = classified.filter((row) => row.workspace === workspace);
    return line([workspace, ...columns.map((column) => countIn(rows, column))]);
  }),
  line([
    `**all ${classified.length}**`,
    `**${inProcess}, ${share}%**`,
    ...columns.slice(1).map((column) => `**${countIn(classified, column)}**`),
  ]),
  "",
  `${postgres.length} files reach Postgres in all, and ${postgres.filter((row) => row.markers.includes("git")).length} of them also reach git.`,
];

process.stdout.write(`${report.join("\n")}\n`);
