import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

import { GARAGE_IMAGE } from "@better-answers/core/store/objects";
import { boundarySchemas, POSTGRES_IMAGE, ULID_PATTERN } from "@better-answers/schema";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const liveLines = (relative: string): readonly string[] =>
  read(relative)
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));

const operationsDocuments = "docs/operations";

/** One workflow step's block, so an assertion about it cannot pass on a neighbour's text. */
const stepNamed = (workflow: string, name: string): string =>
  workflow.split(/^ {6}- name: /m).find((block) => block.startsWith(name)) ?? "";

const deployScripts = (): readonly string[] =>
  readdirSync(path.join(repositoryRoot, "deploy"))
    .filter((file) => file.endsWith(".sh"))
    .sort();

const fencedIn = (script: string, name: string): string | undefined => {
  const opened = script.split(`>>> ${name}`)[1];
  return opened?.slice(opened.indexOf("\n") + 1).split(`# <<< ${name}`)[0];
};

const positionOf = (text: string, needle: string): number => {
  const index = text.indexOf(needle);
  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
  return index;
};

type BashRun = { readonly code: number; readonly output: string };

const bashRan = (lines: readonly string[], input = ""): BashRun => {
  const script = ["set -euo pipefail", 'say() { printf "%s\\n" "$*"; }', ...lines].join("\n");
  try {
    return { code: 0, output: execFileSync("bash", ["-c", script], { encoding: "utf8", input }) };
  } catch (thrown) {
    const failed: { status?: number; stdout?: string } = thrown ?? {};
    return { code: failed.status ?? -1, output: failed.stdout ?? "" };
  }
};

const renovateSchema = z.object({
  enabledManagers: z.array(z.string()),
  customManagers: z
    .array(
      z.object({
        customType: z.string(),
        managerFilePatterns: z.array(z.string()),
        matchStrings: z.array(z.string()),
      }),
    )
    .default([]),
});

const groupOf = (match: RegExpMatchArray, name: string): string => match.groups?.[name] ?? "";

const composeModelSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      networks: z
        .record(z.string(), z.object({ aliases: z.array(z.string()).optional() }).nullable())
        .default({}),
    }),
  ),
  networks: z
    .record(z.string(), z.object({ name: z.string(), external: z.boolean().optional() }))
    .default({}),
});

const composeServices = (file: string): readonly { name: string; body: string }[] => {
  const after = file.split(/^services:\s*$/m)[1] ?? "";
  const blocks = after
    .split(/^(?=  [a-z][a-z0-9_-]*:\s*$)/m)
    .filter((block) => /^  [a-z]/.test(block));
  return blocks.map((block) => ({
    name: (/^  ([a-z][a-z0-9_-]*):/.exec(block)?.[1] ?? "").trim(),
    body: block,
  }));
};

describe("the deploy tree", () => {
  it("has a script tree that parses, every file", () => {
    for (const script of deployScripts()) {
      expect(() =>
        execFileSync("bash", ["-n", path.join(repositoryRoot, "deploy", script)], {
          stdio: "pipe",
        }),
      ).not.toThrow();
    }
    expect(deployScripts()).toEqual(
      expect.arrayContaining([
        "await-release.sh",
        "backup.sh",
        "browse-production.sh",
        "host-setup.sh",
        "local-database.sh",
        "mirror-shell.sh",
        "restore-drill.sh",
        "restore-production.sh",
        "seed-synthetic.sh",
        "uptime-probe.sh",
        "wizard-41.sh",
      ]),
    );
  });

  it("carries no `<read on the day>` placeholder in parsed fields", () => {
    for (const file of [
      "deploy/backup.Dockerfile",
      "deploy/stores.compose.yaml",
      "deploy/platform.compose.yaml",
      "deploy/garage.toml",
    ]) {
      const live = liveLines(file).join("\n");
      expect({ file, placeholder: live.includes("<read on the day") }).toEqual({
        file,
        placeholder: false,
      });
    }
  });

  it("installs the backup image's PostgreSQL client at the database's major", () => {
    const serverMajor = /-pg(\d+)-/.exec(POSTGRES_IMAGE)?.[1];
    const clientMajors = liveLines("deploy/backup.Dockerfile")
      .flatMap((line) => [...line.matchAll(/\bpostgresql-client-(\d+)\b/g)])
      .map((match) => match[1]);

    expect(serverMajor).toBeDefined();
    expect(clientMajors).toEqual([serverMajor]);
  });

  it("builds the backup image from a base pinned by digest", () => {
    const bases = liveLines("deploy/backup.Dockerfile").filter((line) => line.startsWith("FROM "));

    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatch(/^FROM \S+:\S+@sha256:[0-9a-f]{64}$/);
  });

  it("runs the backup service by the digest build.yml pushes", () => {
    const stores = read("deploy/stores.compose.yaml");
    expect(stores).toContain("ghcr.io/betteranswers/backup@${BACKUP_IMAGE_DIGEST:?");
    expect(stores).not.toMatch(/^\s+build:/m);
    expect(read(".github/workflows/build.yml")).toMatch(
      /tier: backup\n\s+context: deploy\n\s+dockerfile: deploy\/backup\.Dockerfile/,
    );
  });

  it("runs the object store on the one pinned Garage image", () => {
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain(`image: ${GARAGE_IMAGE}`);
  });

  it("gives Garage its secrets from the environment, no `*_file` key", () => {
    const garage = read("deploy/garage.toml");
    expect(garage).not.toMatch(/^\s*(rpc_secret_file|admin_token_file)/m);
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain("GARAGE_RPC_SECRET:");
    expect(objectstore?.body).toContain("GARAGE_ADMIN_TOKEN:");
  });

  it("limits every VPC 1 service's memory, and the worker's swap", () => {
    for (const file of ["deploy/stores.compose.yaml", "deploy/platform.compose.yaml"]) {
      const services = composeServices(read(file));
      expect(services.length).toBeGreaterThan(1);
      const unlimited = services
        .filter(
          (service) =>
            !(/\*mem\d+\b/.test(service.body) || /limits:\s*\{\s*memory:/.test(service.body)),
        )
        .map((service) => `${file}: ${service.name}`);
      expect(unlimited).toEqual([]);
    }
    expect(read("deploy/platform.compose.yaml")).toMatch(/^\s+memswap_limit: 3072m/m);
  });

  it("keeps the drill's traps out of the production restore", () => {
    const script = read("deploy/restore-production.sh");
    expect(script).not.toMatch(/wipe_staging|trap .*EXIT|PROD_DATABASE_URL/);
    expect(script).not.toMatch(/rm -rf \/data/);

    expect(script).toContain("pnpm ops replay-erasures --since");
    expect(read(`${operationsDocuments}/RUNBOOK.md`)).toContain("restore-production.sh");
  });

  it("pauses backups from the restore's first change until api answers", () => {
    const lines = liveLines("deploy/restore-production.sh").map((line) => line.trim());
    const linesMatching = (pattern: RegExp): readonly number[] =>
      lines.flatMap((line, index) => (pattern.test(line) ? [index] : []));

    const stopped = linesMatching(/^stores stop backup$/);
    const started = linesMatching(/^stores start backup$/);
    const firstChange = linesMatching(/^platform stop api\b/);
    const smoke = linesMatching(/pnpm ops smoke\b/);

    expect({ stopped: stopped.length, started: started.length }).toEqual({
      stopped: 1,
      started: 1,
    });
    expect({ beforeTheFirstChange: (stopped[0] ?? Infinity) < (firstChange[0] ?? -1) }).toEqual({
      beforeTheFirstChange: true,
    });
    expect({ afterApiAnswers: (started[0] ?? -1) > (smoke[0] ?? Infinity) }).toEqual({
      afterApiAnswers: true,
    });
  });

  it("runs the replay after both stores and before api", () => {
    for (const file of ["deploy/restore-production.sh", "deploy/restore-drill.sh"]) {
      const script = read(file);
      const at = (needle: string): number => {
        const index = script.indexOf(needle);
        expect({ file, needle, found: index >= 0 }).toEqual({ file, needle, found: true });
        return index;
      };
      const objectStore = at("${BACKUP_MIRROR_BUCKET}/objectstore/");
      const gitStore = at("git clone --quiet --bare");
      const replay = at("replay-erasures");
      const apiUp = at("platform up -d --wait api");
      expect({ file, afterTheObjectStore: replay > objectStore }).toEqual({
        file,
        afterTheObjectStore: true,
      });
      expect({ file, afterTheGitStore: replay > gitStore }).toEqual({
        file,
        afterTheGitStore: true,
      });
      expect({ file, beforeApi: replay < apiUp }).toEqual({ file, beforeApi: true });
    }
  });

  it("runs the replay's one-shot on the service holding both stores", () => {
    const services = composeServices(read("deploy/platform.compose.yaml"));
    const api = services.find((service) => service.name === "api");
    const migrate = services.find((service) => service.name === "migrate");
    expect(api?.body).toContain("GIT_STORE_DIR: /data/git");
    expect(api?.body).toContain("- /data/git:/data/git");
    expect(api?.body).toContain("<<: *bootstrap");
    expect(migrate?.body).not.toContain("GIT_STORE_DIR");
    expect(migrate?.body).not.toContain("/data/git");
    for (const file of ["deploy/restore-production.sh", "deploy/restore-drill.sh"]) {
      const line = read(file)
        .split("\n")
        .find((candidate) => candidate.includes("replay-erasures"));

      expect({ file, line }).toEqual({
        file,
        line: expect.stringContaining("run --rm --no-deps api pnpm"),
      });
    }
  });

  it("gives the api its object-store settings, matching garage.toml's region", () => {
    const anchor =
      read("deploy/platform.compose.yaml")
        .split("x-bootstrap: &bootstrap")[1]
        ?.split("\nservices:")[0] ?? "";
    expect(anchor).toContain("S3_ENDPOINT: http://objectstore:3900");
    expect(anchor).toContain("S3_REGION: garage");
    expect(anchor).toContain("S3_BUCKET: ${S3_BUCKET:?");
    expect(anchor).toContain("S3_ACCESS_KEY: ${OBJECTSTORE_ROOT_KEY:?}");
    expect(anchor).toContain("S3_SECRET_KEY: ${OBJECTSTORE_ROOT_SECRET:?}");
    expect(read("deploy/garage.toml")).toContain('s3_region = "garage"');
  });

  it("joins staging's projects on an internal network made first", () => {
    const drill = read("deploy/restore-drill.sh");
    const projects = fencedIn(drill, "the staging projects");
    expect({ markers: projects !== undefined }).toEqual({ markers: true });

    const work = mkdtempSync(path.join(tmpdir(), "staging-projects-"));
    onTestFinished(() => {
      rmSync(work, { recursive: true, force: true });
    });
    const required = new Set(
      ["deploy/stores.compose.yaml", "deploy/platform.compose.yaml"].flatMap((file) =>
        [...read(file).matchAll(/\$\{(\w+):\?/g)].map((match) => match[1] ?? ""),
      ),
    );
    writeFileSync(
      path.join(work, "staging.env"),
      [...required].map((key) => `${key}=staging\n`).join(""),
    );
    const drillRan = (lines: readonly string[]): BashRun =>
      bashRan([
        `REPO_DIR='${repositoryRoot}'`,
        `STAGING_ENV_FILE='${work}/staging.env'`,
        projects ?? "",
        ...lines,
      ]);

    const composed = (project: "stores" | "platform"): readonly string[] => {
      const ran = drillRan([`${project} config --format json`]);
      expect({ project, code: ran.code }).toEqual({ project, code: 0 });
      const model = composeModelSchema.parse(JSON.parse(ran.output));
      return Object.entries(model.services).flatMap(([service, { networks }]) =>
        Object.entries(networks).map(([key, attached]) => {
          const network = model.networks[key];
          const external = network?.external === true ? " external" : "";
          const aliases = (attached?.aliases ?? []).map((alias) => ` as ${alias}`).join("");
          return `${service} on ${network?.name ?? key}${external}${aliases}`;
        }),
      );
    };

    expect([...composed("stores")].sort()).toEqual([
      "backup on better-answers-stores-staging_default",
      "cloudflared on better-answers-stores-staging_default",
      "init on better-answers-stores-staging_default",
      "objectstore on better-answers-staging-shared external as objectstore",
      "objectstore on better-answers-stores-staging_default",
    ]);
    expect([...composed("platform")].sort()).toEqual([
      "api on better-answers-staging-shared external",
      "api on better-answers-staging_default",
      "migrate on better-answers-staging-shared external",
      "migrate on better-answers-staging_default",
      "worker on better-answers-staging-shared external",
      "worker on better-answers-staging_default",
    ]);

    const dockerCalls = (inspectStatus: number): BashRun =>
      drillRan([
        `docker() { printf '%s\\n' "$*" >> '${work}/docker-${String(inspectStatus)}.log'; [ "$1 $2" != "network inspect" ] || return ${String(inspectStatus)}; }`,
        "ensure_staging_network",
        `cat '${work}/docker-${String(inspectStatus)}.log'`,
      ]);
    expect(dockerCalls(1)).toEqual({
      code: 0,
      output:
        "network inspect better-answers-staging-shared\nnetwork create --internal better-answers-staging-shared\n",
    });
    expect(dockerCalls(0)).toEqual({
      code: 0,
      output: "network inspect better-answers-staging-shared\n",
    });
    expect(drill).toMatch(/^say "## 0 [^"\n]*"; ensure_staging_network; wipe_staging$/m);
  });

  it("gives the production compose files no network of their own", () => {
    for (const file of ["deploy/stores.compose.yaml", "deploy/platform.compose.yaml"]) {
      expect({ file, networks: /^\s*networks:/m.test(read(file)) }).toEqual({
        file,
        networks: false,
      });
    }
  });

  it("hands the api its own image's pinned digest", () => {
    const api = composeServices(read("deploy/platform.compose.yaml")).find(
      (service) => service.name === "api",
    );
    const pinnedBy = /^ {4}image: ghcr\.io\/betteranswers\/api@\$\{(\w+):\?\}$/m.exec(
      api?.body ?? "",
    )?.[1];

    expect(pinnedBy).toEqual("API_IMAGE_DIGEST");
    expect(api?.body).toMatch(/^ {6}API_IMAGE_DIGEST: \$\{API_IMAGE_DIGEST:\?\}$/m);
  });

  it("creates Garage's key and bucket in the wizard and drill", () => {
    const wizard = read("deploy/wizard-41.sh");
    expect(wizard).toContain("key create platform-root");
    expect(wizard).toContain("bucket create $S3_BUCKET");
    expect(wizard).toContain("bucket allow --read --write $S3_BUCKET --key platform-root");
    expect(wizard).toContain('write_env S3_BUCKET "$S3_BUCKET"');

    const stages = [...wizard.matchAll(/^stage "/gm)].length;
    expect(wizard).toContain(`TOTAL_STAGES=${stages}`);

    const drill = read("deploy/restore-drill.sh");

    expect(drill).toContain('/garage bucket create "${STAGING_S3_BUCKET}"');
    expect(drill).toContain(
      '/garage bucket allow --read --write "${STAGING_S3_BUCKET}" --key "${STAGING_OBJECTSTORE_ROOT_KEY}"',
    );
    expect(read("deploy/host-setup.sh")).toContain("STAGING_S3_BUCKET=");
  });

  it("runs each graph command as it answers, and records counts", () => {
    const drill = read("deploy/restore-drill.sh");

    expect(drill).toContain('ops graph-rebuild --workspace "${DRILL_WORKSPACE}" --wait');
    expect(drill).toContain('ops graph-sweep --workspace "${DRILL_WORKSPACE}"\n');
    expect(drill).not.toContain('graph-sweep --workspace "${DRILL_WORKSPACE}" --wait');
    expect(drill).toContain('ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"');
    expect(drill).toContain(
      'ops object-store-orphans --workspace "${DRILL_WORKSPACE}" >> "${REPORT}"',
    );
    expect(drill).not.toContain('object-store-orphans --workspace "${DRILL_WORKSPACE}" --list');

    expect(drill).toContain("no stamped run on production to diff against");
    expect(drill).toContain("COUNTS DIFFER");
  });

  it("pins the synthetic workspace's id in drill.env and BACKUPS.md", () => {
    const workspaceId = execFileSync(
      "bash",
      [path.join(repositoryRoot, "deploy/seed-synthetic.sh"), "--workspace-id"],
      { encoding: "utf8" },
    ).trim();

    expect(workspaceId).toEqual("01M2SYNTHET1CAAAAAAAAAAAAA");
    expect(boundarySchemas.workspace.select.shape.id.safeParse(workspaceId).success).toBe(true);
    expect(read("deploy/host-setup.sh")).toContain(`\nDRILL_WORKSPACE=${workspaceId}\n`);
    expect(read(`${operationsDocuments}/BACKUPS.md`)).toContain(`\`${workspaceId}\``);
  });

  it("refuses a DRILL_WORKSPACE that is not a workspace id", () => {
    const drill = read("deploy/restore-drill.sh");

    const guard = fencedIn(drill, "workspace id");
    expect({ markers: guard !== undefined }).toEqual({ markers: true });
    expect(drill.indexOf("# >>> workspace id")).toBeLessThan(drill.indexOf("## 0 wipe staging"));
    expect(guard).toContain(`[[ "\${DRILL_WORKSPACE}" =~ ${ULID_PATTERN} ]]`);

    const ran = (workspace: string): BashRun =>
      bashRan([
        `DEPLOY_DIR=${JSON.stringify(path.join(repositoryRoot, "deploy"))}`,
        `DRILL_WORKSPACE=${JSON.stringify(workspace)}`,
        guard ?? "",
        'say "step 0"',
      ]);

    expect(ran("01M2SYNTHET1CAAAAAAAAAAAAA")).toEqual({ code: 0, output: "step 0\n" });
    expect(ran("ws_synthetic")).toEqual({
      code: 1,
      output:
        "REFUSED: DRILL_WORKSPACE ws_synthetic is not a workspace id; the synthetic fixture's is 01M2SYNTHET1CAAAAAAAAAAAAA\n",
    });
    expect(ran("01m2synthet1caaaaaaaaaaaaa").code).toEqual(1);
  });

  it("seeds the synthetic fixture between the git store and api", () => {
    const drill = read("deploy/restore-drill.sh");
    const at = (needle: string): number => positionOf(drill, needle);

    const gitStore = at("git clone --quiet --bare");
    const seeded = at('"${DEPLOY_DIR}/seed-synthetic.sh" | tee -a "${REPORT}"');
    const repository = at(
      `[ -d "/data/git/\${synthetic_workspace}.git" ] || sudo -u '#1000' git init --quiet --bare --initial-branch main "/data/git/\${synthetic_workspace}.git"`,
    );
    const apiUp = at("platform up -d --wait api");

    expect([gitStore, seeded, repository, apiUp]).toEqual(
      [gitStore, seeded, repository, apiUp].toSorted((left, right) => left - right),
    );
  });

  it("wipes staging with no special case for the graph", () => {
    const drill = read("deploy/restore-drill.sh");
    expect(drill).not.toMatch(/ag_catalog|drop_graph|\bAGE\b/);
    expect(drill).toContain('-f "${DEPLOY_DIR}/empty-database.sql"');
    expect(read("deploy/empty-database.sql")).not.toMatch(/ag_catalog|drop_graph|\bAGE\b/);
    expect(drill).toContain("stagingstore:");
    expect(drill).toContain("seed-synthetic.sh");
  });

  it("proves the rehearsal in its seven steps, in order", () => {
    const drill = read("deploy/restore-drill.sh");
    const at = (needle: string): number => positionOf(drill, needle);
    const steps = [
      "--synthetic --seed",
      'pg_dump --format=plain --dbname="${STAGING_DATABASE_URL}" > "${WORK}/pre-erasure.sql"',
      'dump-grep --tokens "${subject}" < "${WORK}/pre-erasure.sql"',
      "--synthetic --run --report",
      'pg_dump --format=plain --dbname="${STAGING_DATABASE_URL}" > "${WORK}/post-erasure.sql"',
      'dump-grep --tokens "${subject}" < "${WORK}/post-erasure.sql"',
      "cat-file -e",
    ];
    const found = steps.map(at);
    expect(found).toEqual([...found].sort((left, right) => left - right));

    const dumps = drill.split("\n").filter((line) => line.trimStart().startsWith("pg_dump "));
    expect(dumps).toHaveLength(2);
    expect(dumps.filter((line) => line.includes("--exclude"))).toEqual([]);

    expect(drill).toContain("grep -v -E ' of table ([a-z_]+\\.)?(subject_request|suppression)$'");
    expect(drill).toContain("which keep the identifier set by design");

    expect(drill).toContain("the seed added no commit");
  });

  it("fails the drill unless the seed exits 0 or 3", () => {
    const drill = read("deploy/restore-drill.sh");

    const guard = fencedIn(drill, "seed status");
    expect({ markers: guard !== undefined }).toEqual({ markers: true });

    const ran = (status: number): BashRun =>
      bashRan([
        "NOT_BUILT=3",
        'DRILL_WORKSPACE="a-workspace"',
        `platform() { printf 'priya@example.invalid,1 High St,Priya Anand\\n'; return ${String(status)}; }`,
        guard ?? "",
        'say "the proof ran, subject=${subject}"',
      ]);

    const seeded = ran(0);
    expect({ code: seeded.code, proved: seeded.output.includes("the proof ran") }).toEqual({
      code: 0,
      proved: true,
    });

    const notBuilt = ran(3);
    expect({ code: notBuilt.code, failed: notBuilt.output.includes("REHEARSAL FAILED") }).toEqual({
      code: 0,
      failed: false,
    });

    const refused = ran(1);
    expect({ code: refused.code, failed: refused.output.includes("REHEARSAL FAILED") }).toEqual({
      code: 1,
      failed: true,
    });
  });

  it("fails the drill when no pre-erasure chunk holds the subject", () => {
    const drill = read("deploy/restore-drill.sh");

    const check = fencedIn(drill, "found before");
    expect({ markers: check !== undefined }).toEqual({ markers: true });

    const ran = (grepped: readonly string[]): BashRun =>
      bashRan(
        [
          'WORK="$(mktemp -d)"',
          'cat > "${WORK}/pre-erasure.grep"',
          check ?? "",
          'say "the erasure ran"',
        ],
        `${grepped.join("\n")}\n`,
      );

    const inAChunk = ran([
      "subj…st: present in 1 line(s) of table public.user",
      'subj…st: present in 1 line(s) of table index."chunk_01K5ZQ8WJ6T3M4N7P9R2S0V1X"',
    ]);
    const inNoChunk = ran(["subj…st: present in 1 line(s) of table public.user"]);
    const inNoTable = ran(["subj…st: absent"]);

    expect(inAChunk).toEqual({ code: 0, output: "the erasure ran\n" });
    expect(inNoChunk).toEqual({
      code: 1,
      output:
        "REHEARSAL FAILED: the seeded subject is in no chunk of the pre-erasure dump, so the dump grep after would prove nothing of the index\n",
    });
    expect(inNoTable).toEqual({
      code: 1,
      output: "REHEARSAL FAILED: the seeded subject is in no table of the pre-erasure dump\n",
    });
  });

  it("prunes the mirror only after a push that replaced refs", () => {
    const backup = read("deploy/backup.sh");
    expect(backup).toContain("push --mirror --porcelain");
    expect(backup).not.toContain("push --mirror --quiet");
    expect(backup).toContain("grep -qE '^[+-]'");
    expect(backup).toContain('prune-repo "${ws}"');
  });

  it("lets the mirror key run init-repo, git-receive-pack and prune-repo only", () => {
    const shell = read("deploy/mirror-shell.sh");
    expect(shell).toContain('"init-repo "*)');
    expect(shell).toContain('"git-receive-pack "*)');
    expect(shell).toContain("exec git-receive-pack");
    expect(shell).toContain('"prune-repo "*)');

    expect(shell).toContain('is_workspace "${ws}" || refuse "prune-repo: not a workspace id"');
    expect(shell).toContain('git -C "${target}" reflog expire --expire=now --all');
    expect(shell).toContain('git -C "${target}" gc --prune=now --quiet');

    expect([...shell.matchAll(/^ {2}"[a-z-]+ "\*\)/gm)]).toHaveLength(3);
    expect(shell).toContain('*) refuse "not a mirror command" ;;');
    expect(read("deploy/host-setup.sh")).toContain(
      'command="/usr/local/bin/mirror-shell /data/mirror",restrict',
    );
    expect(read("deploy/backup.sh")).toContain("init-repo");
  });

  it("matches each digest alone through env, with the client-data switch", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("^sha256:[0-9a-f]{64}$");
    expect(release).toMatch(
      /env:\n\s+API_DIGEST: \$\{\{ steps\.d\.outputs\.api \}\}\n\s+WORKER_DIGEST: \$\{\{ steps\.d\.outputs\.worker \}\}/,
    );

    /** Every workflow expression is a binding, never a token spliced into a shell line. */
    const spliced = release
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("${{"))
      .filter((line) => !/^[A-Z_]+: \$\{\{ [^}]+ \}\}$/.test(line))
      .filter((line) => !/^(ref|registry|username|password): /.test(line));
    expect(spliced).toEqual([]);
    expect(release).toContain("CLIENT_DATA_ON_BOX");
  });

  it("tags each promotion once, pushes no branch, and smokes afterwards", () => {
    const release = read(".github/workflows/release.yml");

    // The record is a tag and nothing else: `main` is merge-queue-only, so a push to it
    // from the workflow is refused.
    expect(release).toContain('tag="release/${stamp}"');
    expect(release).toContain('git tag --annotate --message "${message}" "${tag}" "${head}"');
    // The head makes two promotions in one second two tags rather than a rejected push.
    expect(release).toContain('stamp="${when//[-:]/}-${head:0:7}"');

    const pushes = release
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("git push "));
    expect(pushes).toEqual(['git push origin "refs/tags/${tag}"']);
    expect(release).not.toContain("HEAD:main");
    expect(release).not.toContain("git commit");

    const record = stepNamed(release, "record the promotion");
    /**
     * Against the tag's own message, not the step: the step summary echoes four of these and would
     * satisfy a message that carried none of them.
     */
    const message = /message="\$\(printf[\s\S]*?\)"/.exec(record)?.[0] ?? "";
    expect(message).not.toEqual("");
    for (const field of [
      "${when}",
      "${ACTOR}",
      "${API_DIGEST}",
      "${WORKER_DIGEST}",
      "${rode}",
      "${head}",
      "${points}",
    ]) {
      expect(message).toContain(field);
    }

    const stepAt = (name: string): number => {
      const index = release.indexOf(`- name: ${name}`);
      expect(index).toBeGreaterThan(-1);
      return index;
    };
    // The smoke follows the record, so a promotion whose smoke fails still has its tag.
    expect(stepAt("record the promotion")).toBeLessThan(stepAt("post-deploy smoke"));
  });

  it("smokes until /health names this release's digest, then reads discovery", () => {
    const smoke = stepNamed(read(".github/workflows/release.yml"), "post-deploy smoke");

    expect(smoke).toMatch(/env:\n\s+API_DIGEST: \$\{\{ steps\.d\.outputs\.api \}\}\n/);
    const waits = smoke.indexOf('deploy/await-release.sh "${PUBLIC_URL}" "${API_DIGEST}"');
    expect(waits).toBeGreaterThan(-1);
    expect(smoke.indexOf("/.well-known/oauth-protected-resource/mcp")).toBeGreaterThan(waits);

    /**
     * The build being replaced answers 200 until the swap, so a request that reads the status alone
     * passes on it.
     */
    const readsTheStatusAlone = smoke
      .split("\n")
      .filter((line) => line.includes("curl") && line.includes("/health"));
    expect(readsTheStatusAlone).toEqual([]);
  });

  it("waits out the pull, within the job's timeout", () => {
    const script = read("deploy/await-release.sh");
    const polls = Number(/AWAIT_RELEASE_POLLS:-(\d+)/.exec(script)?.[1]);
    const delaySeconds = Number(/AWAIT_RELEASE_DELAY_SECONDS:-(\d+)/.exec(script)?.[1]);
    const pollSeconds = Number(/curl [^\n]*--max-time (\d+)/.exec(script)?.[1]);
    const jobMinutes = Number(
      /timeout-minutes: (\d+)/.exec(read(".github/workflows/release.yml"))?.[1],
    );

    // Twice the three minutes a fresh image took to pull and start, end to end; no sleep follows the last poll.
    expect((polls - 1) * delaySeconds).toBeGreaterThanOrEqual(360);
    expect(polls * pollSeconds + (polls - 1) * delaySeconds).toBeLessThan(jobMinutes * 60);
  });

  it("says per digest whether it was resolved or passed in", () => {
    const record = stepNamed(read(".github/workflows/release.yml"), "record the promotion");

    // Four dispatch shapes, and the tag's message is true of each digest in all of them.
    expect(record).toContain('if [ -z "${IN_API}" ] && [ -z "${IN_WORKER}" ]; then');
    expect(record).toContain('elif [ -n "${IN_API}" ] && [ -n "${IN_WORKER}" ]; then');
    expect(record).toContain('elif [ -n "${IN_API}" ]; then');

    const points = [...record.matchAll(/^\s*points="([^"]+)"$/gm)].map((match) => match[1] ?? "");
    expect(points).toHaveLength(4);
    expect(new Set(points).size).toEqual(4);
    for (const sentence of points) {
      expect(sentence).toContain("main's head");
    }
    expect(
      points.filter((sentence) => sentence.includes("both digests were resolved")),
    ).toHaveLength(1);
    expect(points.filter((sentence) => sentence.includes("were passed in"))).toHaveLength(1);
  });

  it("lets no workflow commit to a branch", () => {
    const workflows = readdirSync(path.join(repositoryRoot, ".github/workflows"))
      .filter((file) => file.endsWith(".yml"))
      .sort();
    expect(workflows.length).toBeGreaterThan(1);

    const writes = workflows.flatMap((file) =>
      read(`.github/workflows/${file}`)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^git (commit|push)\b/.test(line))
        .map((line) => `${file}: ${line}`),
    );
    expect(writes).toEqual(['release.yml: git push origin "refs/tags/${tag}"']);
  });

  it("freezes RELEASES.md and points later promotions at their tags", () => {
    const releases = read("deploy/RELEASES.md");
    expect(releases).toContain("| When (UTC) | By | api | worker | Rode on |");
    expect(releases).toContain("release/<UTC stamp>-<short commit>");
    expect(releases).toContain("git tag --list 'release/*' --sort=-creatordate");
    // An on-box promotion, which the unreachable-Coolify carve-out still allows, has a
    // recorded home: the same tag, made by hand.
    expect(releases).toContain("Access debt recorded 04/09/2026");
    expect(releases).toContain('git push origin "refs/tags/${tag}"');

    const rows = releases.split("\n").filter((line) => /^\| 20\d\d-/.test(line));
    // Nothing appends to the table again, so its last row stays the last promotion in it.
    expect(rows.at(-1)).toContain("2026-09-23T04:26:58Z");
    expect(read(".github/workflows/release.yml")).not.toContain("deploy/RELEASES.md");

    const runbook = read(`${operationsDocuments}/RUNBOOK.md`);
    expect(runbook).toContain("git tag --list 'release/*' --sort=-creatordate");
    expect(runbook).toContain("release/*` tags (failed, rolled back to)");
  });

  it("promotes main's head image, and refuses by name without one", () => {
    const release = read(".github/workflows/release.yml");
    const build = read(".github/workflows/build.yml");

    expect(build).toContain("type=sha,prefix=sha-");
    expect(build).not.toContain("type=raw");
    expect(release).toMatch(/ref: main\n/);
    expect(release).toContain('head="$(git rev-parse HEAD)"');

    const cutTo = /DOCKER_METADATA_SHORT_SHA_LENGTH: "(\d+)"/.exec(build)?.[1];
    expect(cutTo).toEqual("7");
    expect(release).toContain(`tag="sha-\${head:0:${cutTo ?? ""}}"`);
    expect(release).toContain('"ghcr.io/${OWNER}/$1:${tag}"');
    expect(release).not.toMatch(/ghcr\.io\/\$\{OWNER\}\/[^"\s]*:main\b/);

    expect(release).toMatch(/echo "::error::[^"\n]*\$\{head\}[^"\n]*" >&2\n\s+return 1/);
    expect(read("deploy/RELEASES.md")).toContain("`sha-<short>`");
  });

  it("annotates every version an image fetches for Renovate to read", () => {
    const renovate = renovateSchema.parse(JSON.parse(read("renovate.json")));
    const manager = renovate.customManagers.find((candidate) => candidate.customType === "regex");

    const patterns = manager?.managerFilePatterns ?? [];
    expect(patterns.filter((pattern) => !/^\/.+\/$/.test(pattern))).toEqual([]);
    const selects = patterns.map((pattern) => new RegExp(pattern.slice(1, -1)));
    const dockerfiles = [
      ...read(".github/workflows/build.yml").matchAll(/^\s+dockerfile: (\S+)$/gm),
    ]
      .map((match) => match[1] ?? "")
      .sort();

    const pinned = dockerfiles.flatMap((file) =>
      [...read(file).matchAll(/^ARG (\w+_VERSION)=(\S+)$/gm)].map(
        (match) => `${file}: ${match[1] ?? ""}=${match[2] ?? ""}`,
      ),
    );
    const readByRenovate = dockerfiles.flatMap((file) =>
      selects.some((pattern) => pattern.test(file))
        ? (manager?.matchStrings ?? []).flatMap((matchString) =>
            [...read(file).matchAll(new RegExp(matchString, "g"))].map((match) => ({
              pin: `${file}: ${/ARG (\w+_VERSION)=/.exec(match[0])?.[1] ?? ""}=${groupOf(match, "currentValue")}`,
              from: `${groupOf(match, "datasource")} ${groupOf(match, "depName")}`,
            })),
          )
        : [],
    );

    const annotated = dockerfiles.flatMap((file) => [
      ...read(file).matchAll(/^# renovate: /gm),
    ]).length;

    expect(renovate.enabledManagers).toContain("custom.regex");
    expect(dockerfiles.length).toBeGreaterThan(2);
    expect(annotated).toEqual(readByRenovate.length);
    expect(readByRenovate.map((dependency) => dependency.pin)).toEqual(pinned);
    expect(readByRenovate.map((dependency) => dependency.from)).toEqual([
      "pypi git-filter-repo",
      "github-releases rclone/rclone",
      "github-releases FiloSottile/age",
    ]);
  });

  it("leaves staging to the drill, with no build.yml job", () => {
    const build = read(".github/workflows/build.yml");
    expect(build).not.toMatch(/^\s+staging:\s*$/m);
    expect(build).not.toContain("COOLIFY_STAGING_APP_UUID");
  });

  it("names the api fence, hostname roles and both uptime paths", () => {
    const coolify = read(`${operationsDocuments}/coolify.md`);
    expect(coolify).toContain("apps/api/src/ingress/hostnames.ts");
    const unnamedRoles = ["app", "agent", "apex"].filter(
      (role) => !new RegExp(`\\b${role}\\b`).test(coolify),
    );
    expect(unnamedRoles).toEqual([]);
    expect(coolify).toContain("http_status:404");
    expect(coolify).toContain("/health");
    expect(coolify).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(coolify).not.toMatch(/\bmcp\.\b/);
  });

  it("documents the backup identity's home and a VPC 2 compromise", () => {
    const silent = [
      `${operationsDocuments}/SECRETS.md`,
      `${operationsDocuments}/RUNBOOK.md`,
    ].filter(
      (file) =>
        !(/VPC 2.*root-only|root-only.*VPC 2/s.test(read(file)) && /plaintext/.test(read(file))),
    );
    expect(silent).toEqual([]);
  });
});
