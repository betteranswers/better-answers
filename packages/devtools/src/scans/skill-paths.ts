import { byCodeUnit } from "@better-answers/schema/code-unit";

export const SKILLS_FOLDER = ".claude/skills";

const WHERE_THE_PATHS_LIVE = "packages/devtools/src/scans/skill-paths.ts";

export const FIX_COMMAND = "pnpm run skill-paths --write";

export const SYMLINKED_SKILL = "better-answers-design";

const UPDATE_COMMAND = "pnpm run skills-update";

export type SkillScope = {
  readonly skill: string;
  readonly paths: readonly string[];
  readonly local?: true;
};

const API = "apps/api/**";
const WEB_API_CLIENT = "apps/web/src/shared/api/**";
const WORKFLOWS = [".github/workflows/**", ".github/actions/**"];

export const SCOPES: readonly SkillScope[] = [
  { skill: "adapter-fetch", paths: [API] },
  { skill: "auth", paths: [API] },
  { skill: "caching", paths: [API] },
  { skill: "client-setup", paths: [API, WEB_API_CLIENT] },
  { skill: "email-best-practices", paths: [API] },
  { skill: "error-handling", paths: [API, WEB_API_CLIENT] },
  { skill: "hono", paths: [API] },
  {
    skill: "implementing-gdpr-data-subject-access-request",
    paths: [API, "packages/core/**"],
  },
  { skill: "links", paths: [API, WEB_API_CLIENT] },
  { skill: "middlewares", paths: [API] },
  { skill: "non-json-content-types", paths: [API] },
  { skill: "openapi", paths: [API] },
  { skill: "resend", paths: [API] },
  { skill: "security-audit", paths: [API] },
  { skill: "server-setup", paths: [API] },
  { skill: "server-side-calls", paths: [API] },
  { skill: "subscriptions", paths: [API] },
  { skill: "trpc-router", paths: [API] },
  { skill: "validators", paths: [API] },
  { skill: "playwright-specs", paths: ["apps/web/**"] },
  { skill: "react-query-setup", paths: ["apps/web/**"] },
  { skill: "pii-detection-pipeline", paths: ["apps/worker/**"] },
  { skill: "pii-in-unstructured", paths: ["apps/worker/**"] },
  { skill: "ci-cd-and-automation", paths: WORKFLOWS },
  { skill: "writing-react-effects", paths: ["apps/web/**"], local: true },
  { skill: "cocoindex", paths: ["apps/worker/**"], local: true },
  { skill: "github-actions-templates", paths: WORKFLOWS, local: true },
  { skill: "coolify-compose", paths: ["deploy/**"], local: true },
  { skill: "coolify-deploy", paths: ["deploy/**"], local: true },
  { skill: "better-answers-design", paths: [] },
  { skill: "mutation-testing", paths: [] },
  { skill: "renovate-prs", paths: [] },
  { skill: "survey-architecture", paths: [] },
  { skill: "verify", paths: [] },
];

const FRONTMATTER = /^---\n(?<body>[\s\S]*?)\n---(?=\n|$)/u;

const PATHS_KEY = /^paths:[^\n]*(?:\n[ \t]+[^\n]*)*(?:\n|$)/mu;

export const pathsLine = (paths: readonly string[]): string => `paths: "${paths.join(", ")}"`;

export const pathsIn = (text: string): readonly string[] => {
  const body = FRONTMATTER.exec(text)?.groups?.["body"];
  const key = body === undefined ? null : PATHS_KEY.exec(body);
  if (key === null) return [];
  return key[0]
    .replace(/^paths:/u, "")
    .replace(/\n[ \t]*-[ \t]*/gu, ",")
    .split(",")
    .map((one) => one.trim().replace(/^["']|["']$/gu, ""))
    .filter((one) => one !== "");
};

export const withPaths = (text: string, paths: readonly string[]): string => {
  const match = FRONTMATTER.exec(text);
  const body = match?.groups?.["body"];
  if (match === null || body === undefined) throw new Error("the file has no frontmatter");
  const kept = body.replace(PATHS_KEY, "").trimEnd();
  const next = paths.length === 0 ? kept : `${kept}\n${pathsLine(paths)}`;
  return `---\n${next}\n---${text.slice(match[0].length)}`;
};

export type SkillOnDisk = {
  readonly skill: string;
  readonly tracked: boolean;
  readonly symlink: boolean;
  readonly linkTargetTracked: boolean;
  readonly text: string | null;
};

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((one, index) => one === right[index]);

const recovery = (skill: string): string =>
  `Run git checkout HEAD -- ${SKILLS_FOLDER}/${skill} to restore it, then update with ${UPDATE_COMMAND}, which installs a real copy. Never delete its row.`;

const describe = (paths: readonly string[]): string =>
  paths.length === 0 ? "no paths line" : pathsLine(paths);

const unreadableFinding = (one: SkillOnDisk): string | null => {
  if (one.symlink && !(one.skill === SYMLINKED_SKILL && one.linkTargetTracked)) {
    return `${SKILLS_FOLDER}/${one.skill}: is a symlink, so a commit would delete the tracked skill. ${recovery(one.skill)}`;
  }
  if (one.text !== null || !one.tracked) return null;
  return `${SKILLS_FOLDER}/${one.skill}/SKILL.md: a tracked skill whose SKILL.md cannot be read. ${recovery(one.skill)}`;
};

const findingOf = (one: SkillOnDisk, scope: SkillScope | undefined): string | null => {
  const folder = `${SKILLS_FOLDER}/${one.skill}`;
  if (scope === undefined) {
    if (one.text === null && !one.symlink) return null;
    return `${folder}: no row in ${WHERE_THE_PATHS_LIVE}. Add one, with its paths or an empty list for a skill that stays unscoped.`;
  }
  const unreadable = unreadableFinding(one);
  if (unreadable !== null || one.text === null) return unreadable;
  const held = pathsIn(one.text);
  if (sameList(held, scope.paths)) return null;
  return `${folder}/SKILL.md: its frontmatter holds ${describe(held)}, and ${WHERE_THE_PATHS_LIVE} wants ${describe(scope.paths)}. Run ${FIX_COMMAND}.`;
};

export const findingsFor = (
  onDisk: readonly SkillOnDisk[],
  scopes: readonly SkillScope[] = SCOPES,
): readonly string[] => {
  const table = new Map(scopes.map((one) => [one.skill, one]));
  const found: string[] = [...onDisk]
    .sort((a, b) => byCodeUnit(a.skill, b.skill))
    .flatMap((one) => findingOf(one, table.get(one.skill)) ?? []);
  const trackedSkills = new Set(onDisk.filter((one) => one.tracked).map((one) => one.skill));
  for (const scope of scopes) {
    if (scope.local === true || trackedSkills.has(scope.skill)) continue;
    found.push(
      `${scope.skill}: ${WHERE_THE_PATHS_LIVE} names a skill that is not tracked under ${SKILLS_FOLDER}/. Delete the row, or mark it local when the skill stays untracked.`,
    );
  }
  return found;
};
