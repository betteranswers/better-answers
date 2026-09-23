import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GARAGE_IMAGE } from "@better-answers/core/store/objects";
import { POSTGRES_IMAGE } from "@better-answers/schema";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const operationsDocuments = "docs/operations";

const deployScripts = (): readonly string[] =>
  readdirSync(path.join(repositoryRoot, "deploy"))
    .filter((file) => file.endsWith(".sh"))
    .sort();

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

describe("the deploy tree (T-005)", () => {
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
        "backup.sh",
        "host-setup.sh",
        "mirror-shell.sh",
        "restore-drill.sh",
        "restore-production.sh",
        "seed-synthetic.sh",
        "uptime-probe.sh",
        "wizard-41.sh",
      ]),
    );
  });

  it("carries no `<read on the day>` placeholder in a field that must parse", () => {
    for (const file of [
      "deploy/backup.Dockerfile",
      "deploy/stores.compose.yaml",
      "deploy/platform.compose.yaml",
      "deploy/garage.toml",
    ]) {
      const live = read(file)
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      expect({ file, placeholder: live.includes("<read on the day") }).toEqual({
        file,
        placeholder: false,
      });
    }
  });

  it("builds the backup image on the one pinned database image, so pg_dump never skews from the server", () => {
    expect(read("deploy/backup.Dockerfile")).toContain(`FROM ${POSTGRES_IMAGE}`);
  });

  it("runs the backup service by digest from the image build.yml pushes, not from a host build", () => {
    const stores = read("deploy/stores.compose.yaml");
    expect(stores).toContain("ghcr.io/betteranswers/backup@${BACKUP_IMAGE_DIGEST:?");
    expect(stores).not.toMatch(/^\s+build:/m);
    expect(read(".github/workflows/build.yml")).toMatch(
      /tier: backup\n\s+context: deploy\n\s+dockerfile: deploy\/backup\.Dockerfile/,
    );
  });

  it("runs the object store on the one pinned Garage image, so the estate and the harness cannot skew", () => {
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain(`image: ${GARAGE_IMAGE}`);
  });

  it("gives Garage its secrets from the environment and names no `*_file` key", () => {
    const garage = read("deploy/garage.toml");
    expect(garage).not.toMatch(/^\s*(rpc_secret_file|admin_token_file)/m);
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain("GARAGE_RPC_SECRET:");
    expect(objectstore?.body).toContain("GARAGE_ADMIN_TOKEN:");
  });

  it("puts an explicit memory limit on every VPC 1 service, and a swap allowance on the worker", () => {
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

  it("keeps the production restore free of the drill's traps: no wipe, no exit trap, no second DSN, the replay mandatory", () => {
    const script = read("deploy/restore-production.sh");
    expect(script).not.toMatch(/wipe_staging|trap .*EXIT|PROD_DATABASE_URL/);
    expect(script).not.toMatch(/rm -rf \/data/);

    expect(script).toContain("pnpm ops replay-erasures --since");
    expect(read(`${operationsDocuments}/RUNBOOK.md`)).toContain("restore-production.sh");
  });

  it("runs the replay after the object store and the git store, and before api, in both restore scripts", () => {
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

  it("runs the replay's one-shot on the one service that carries the git store and the object store", () => {
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

  it("gives the api the object-store settings its door reads, the bucket named and the region matching garage.toml", () => {
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

  it("creates Garage's root key and the platform's bucket — the wizard for production, the drill for staging", () => {
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

  it("runs the four graph commands the way each of them answers, and records counts it has nothing to diff", () => {
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

  it("wipes staging without a graph special case: the graph is plain tables in `public` (ADR 0032)", () => {
    const drill = read("deploy/restore-drill.sh");
    expect(drill).not.toMatch(/ag_catalog|drop_graph|\bAGE\b/);
    expect(drill).toContain("drop schema if exists public cascade");
    expect(drill).toContain("stagingstore:");
    expect(drill).toContain("seed-synthetic.sh");
  });

  it("proves the rehearsal in seven steps, in order: seed · dump · found · erase · dump · gone · gone from git", () => {
    const drill = read("deploy/restore-drill.sh");
    const at = (needle: string): number => {
      const index = drill.indexOf(needle);
      expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
      return index;
    };
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

  it("fails the drill when the rehearsal's seed exits anything but the 3 that means not built", () => {
    const drill = read("deploy/restore-drill.sh");

    const opened = drill.split(">>> seed status")[1];
    const guard = opened?.slice(opened.indexOf("\n") + 1).split("# <<< seed status")[0];
    expect({ markers: guard !== undefined }).toEqual({ markers: true });

    const ran = (status: number): { readonly code: number; readonly output: string } => {
      const script = [
        "set -euo pipefail",
        "NOT_BUILT=3",
        'DRILL_WORKSPACE="a-workspace"',
        'say() { printf "%s\\n" "$*"; }',
        `platform() { printf 'priya@example.invalid,1 High St,Priya Anand\\n'; return ${String(status)}; }`,
        guard ?? "",
        'say "the proof ran, subject=${subject}"',
      ].join("\n");
      try {
        return { code: 0, output: execFileSync("bash", ["-c", script], { encoding: "utf8" }) };
      } catch (thrown) {
        const failed: { status?: number; stdout?: string } = thrown ?? {};
        return { code: failed.status ?? -1, output: failed.stdout ?? "" };
      }
    };

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

  it("prunes the mirror after a --mirror push that replaced refs, and only then", () => {
    const backup = read("deploy/backup.sh");
    expect(backup).toContain("push --mirror --porcelain");
    expect(backup).not.toContain("push --mirror --quiet");
    expect(backup).toContain("grep -qE '^[+-]'");
    expect(backup).toContain('prune-repo "${ws}"');
  });

  it("lets the mirror key run init-repo, git-receive-pack and prune-repo, and nothing else", () => {
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

  it("matches each promoted digest on its own through env, appends every promotion to RELEASES.md, and carries Q7's switch", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("^sha256:[0-9a-f]{64}$");
    expect(release).toMatch(
      /env:\n\s+API_DIGEST: \$\{\{ steps\.d\.outputs\.api \}\}\n\s+WORKER_DIGEST: \$\{\{ steps\.d\.outputs\.worker \}\}/,
    );

    const interpolated = release
      .split("\n")
      .filter((candidate) => /\$\{\{ steps\.d\.outputs/.test(candidate))
      .map((line) => line.trim())
      .filter((line) => !/^(API|WORKER)_DIGEST: /.test(line));
    expect(interpolated).toEqual([]);
    expect(release).toContain("deploy/RELEASES.md");
    expect(release).toContain("CLIENT_DATA_ON_BOX");
    expect(read("deploy/RELEASES.md")).toContain("| When (UTC) | By | api | worker | Rode on |");
    expect(read(`${operationsDocuments}/RUNBOOK.md`)).toContain("RELEASES.md");
  });

  it("promotes the image of main's head commit, and refuses by name when that commit has none", () => {
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

  it("annotates every version an image fetches by name, so Renovate's custom manager reads it", () => {
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
              pin: `${file}: ${/ARG (\w+_VERSION)=/.exec(match[0])?.[1] ?? ""}=${match.groups?.["currentValue"] ?? ""}`,
              from: `${match.groups?.["datasource"] ?? ""} ${match.groups?.["depName"] ?? ""}`,
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

  it("has no staging job in build.yml: staging is brought up by the drill procedure", () => {
    const build = read(".github/workflows/build.yml");
    expect(build).not.toMatch(/^\s+staging:\s*$/m);
    expect(build).not.toContain("COOLIFY_STAGING_APP_UUID");
  });

  it("names the app's own fence beside the tunnel's rules, one rule per hostname role, and the two uptime paths", () => {
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

  it("says where the backup identity lives and what a VPC 2 compromise means, in both files", () => {
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
