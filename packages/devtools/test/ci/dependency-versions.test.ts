import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot, workspacePackages } from "@better-answers/devtools/paths";

const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

const versions = z.record(z.string(), z.string()).default({});

const manifestSchema = z.object({
  dependencies: versions,
  devDependencies: versions,
  peerDependencies: versions,
});

const manifestOf = (relative: string): z.infer<typeof manifestSchema> =>
  manifestSchema.parse(JSON.parse(read(relative)));

const renovateSchema = z.object({
  packageRules: z.array(
    z.object({
      matchPackageNames: z.array(z.string()).optional(),
      matchUpdateTypes: z.array(z.string()).optional(),
      groupName: z.string().optional(),
      allowedVersions: z.string().optional(),
    }),
  ),
});

const packageRules = renovateSchema.parse(JSON.parse(read("renovate.json"))).packageRules;

const holdOn = (pattern: string): string => {
  const hold = packageRules.find(
    (rule) => rule.allowedVersions !== undefined && rule.matchPackageNames?.includes(pattern),
  )?.allowedVersions;
  if (hold === undefined) {
    throw new Error(
      `renovate.json holds no version for ${pattern}, and a deleted hold must fail here rather than read as one that matches`,
    );
  }
  return hold;
};

const installedWithThePasskeyPlugin = (name: string): z.infer<typeof manifestSchema> =>
  manifestOf(path.join("apps/api/node_modules", name, "package.json"));

const ceilingOf = (caretRange: string): string => {
  const major = /^\^(\d+)\./.exec(caretRange)?.[1];
  if (major === undefined) throw new Error(`${caretRange} is not a caret range`);
  return `<${Number(major) + 1}`;
};

describe("renovate.json's better-auth holds", () => {
  it("holds @better-auth/utils at the version better-auth depends on", () => {
    const required =
      installedWithThePasskeyPlugin("better-auth").dependencies["@better-auth/utils"];

    expect(required).toMatch(/^\d+\.\d+\.\d+$/);
    expect(holdOn("@better-auth/utils")).toBe(required);
    expect(manifestOf("apps/api/package.json").dependencies["@better-auth/utils"]).toBe(required);
  });

  it("holds @simplewebauthn below the next major passkey takes", () => {
    const passkey = installedWithThePasskeyPlugin("@better-auth/passkey").dependencies;
    const ceilings = ["@simplewebauthn/server", "@simplewebauthn/browser"].map((name) =>
      ceilingOf(passkey[name] ?? ""),
    );

    expect(new Set(ceilings).size).toBe(1);
    expect(holdOn("@simplewebauthn/**")).toBe(ceilings[0]);
  });

  it("groups better-auth after the npm non-major rule", () => {
    const groupAt = (name: string): number =>
      packageRules.findIndex((rule) => rule.groupName === name);

    expect(groupAt("npm non-major")).toBeGreaterThanOrEqual(0);
    expect(groupAt("better-auth")).toBeGreaterThan(groupAt("npm non-major"));
  });
});

const rootAndWorkspaceManifests = (): readonly string[] => [".", ...workspacePackages()];

const pinsOf = (directory: string): readonly (readonly [string, string])[] => {
  const manifest = manifestOf(path.join(directory, "package.json"));
  return [
    ...Object.entries(manifest.dependencies),
    ...Object.entries(manifest.devDependencies),
  ].filter(([, version]) => !version.startsWith("workspace:"));
};

describe("the workspaces' manifests", () => {
  it("name each external package at one version", () => {
    const named = new Map<string, { directory: string; version: string }[]>();
    for (const directory of rootAndWorkspaceManifests()) {
      for (const [name, version] of pinsOf(directory)) {
        named.set(name, [...(named.get(name) ?? []), { directory, version }]);
      }
    }
    const split = [...named.entries()]
      .filter(([, pins]) => new Set(pins.map((pin) => pin.version)).size > 1)
      .map(
        ([name, pins]) =>
          `${name}: ${pins.map((pin) => `${pin.directory} ${pin.version}`).join(" | ")}`,
      );

    expect(
      rootAndWorkspaceManifests().length,
      "the root manifest counts: it pins the same lint and type tools devtools does",
    ).toBeGreaterThan(4);
    expect(
      split,
      "two workspaces name one package at two versions, so the lock carries two copies. Move them together.",
    ).toEqual([]);
  });
});
