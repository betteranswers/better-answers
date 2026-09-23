export const jscpdConfig = {
  paths: ["apps", "packages"],

  formats: ["typescript", "tsx", "python"],

  minLines: 5,
  minTokens: 50,
  threshold: 0,
  ignore: [
    "apps/web/src/shared/ui/**",

    "**/lifts/**",

    "apps/worker/src/better_answers_worker/schema_view.py",

    "pnpm-lock.yaml",
    "apps/worker/uv.lock",

    "**/node_modules/**",
    "**/dist/**",
    "**/.venv/**",
    "**/.claude/worktrees/**",
  ],
};
