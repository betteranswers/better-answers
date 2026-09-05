import type { KnipConfig } from "knip";

/**
 * knip over the pnpm workspace, as a step of the root `check`: a file no code reaches, an
 * export nothing imports, a dependency no workspace uses and a dependency used but never
 * declared each fail the branch.
 *
 * **What is not here, and why.** The tier's process entry points — the api's `main.ts`,
 * `migrate.ts` and `ops.ts`, the two servers its suite exposes in `tests/serve.ts` and
 * `tests/local.ts`, the schema's worker-view generator, the SPA's `main.tsx`, the two oxlint
 * plugins under `packages/devtools` and the `check` runner — are every one of them already
 * reached by knip's own plugins, which read the manifests' scripts, the SPA's `index.html`
 * and `.oxlintrc.json`'s `jsPlugins` specifiers. Naming them again is a second copy of the
 * manifest, and knip says so on every run ("Remove redundant entry pattern"): a
 * configuration that argues with the tool teaches the next session to ignore its output.
 * They are left to be inferred, which also keeps the gate honest — the day a manifest stops
 * naming one, knip reports the file as unreached rather than an entry nobody starts.
 *
 * What is left is the four things knip cannot know, each with its reason beside it. This is
 * TypeScript rather than JSON so those reasons can be sentences.
 */
const config: KnipConfig = {
  // `uv` is the Python tier's package manager, named by the root `check:worker` step and by
  // the pre-commit hook. It is installed on the machine, never by npm, so there is no
  // manifest for knip to find it in.
  ignoreBinaries: ["uv"],

  workspaces: {
    "apps/api": {
      ignore: [
        // A verbatim third-party snapshot (ADR 0027): edited upstream and never here, which
        // is why it also sits outside this repository's linter, formatter and compiler.
        "lifts/**",
        // A stand-in for the SPA's build, reached over HTTP by the endpoint suite rather
        // than imported by it — a path a request asks for is not an edge in a module graph.
        "tests/fixtures/**",
      ],
    },

    "apps/web": {
      entry: [
        // Registry source under ADR 0033 — shadcn, Kibo UI and AI Elements components taken
        // into this repository as source. Fourteen have no consumer today: seven are the
        // People screens' (T-027, T-028), and seven are the answer surface the registry
        // choice was calibrated for, which has no ticket yet. A component installed for a
        // surface that does not exist yet is not dead code, so the directory is an entry
        // point and the dependencies only it imports count as used.
        "src/shared/ui/**",
      ],
    },

    "packages/core": {
      ignore: [
        // The git, graph and object-store doors (ADR 0029): each is a module whose invariant
        // is written down and whose implementation has not landed. They are not exported
        // from the store barrel, because exporting an empty door would widen an interface
        // for nothing, and they are not deleted, because the invariant is the decision.
        // Delete a line the day its door gains an implementation.
        "src/store/git/index.ts",
        "src/store/graph/index.ts",
        "src/store/objects/index.ts",
      ],
    },

    "packages/devtools": {
      // The anti-slop lift, as under `apps/api`: a verbatim third-party snapshot.
      ignore: ["lifts/**"],
      // The package depends on itself so its own suite reaches the runner the way every
      // other suite does — through the `exports` map, which is the interface under test.
      ignoreDependencies: ["@better-answers/devtools"],
    },
  },
};

export default config;
