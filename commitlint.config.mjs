const TICKET = /\bT-\d+\b/;

export default {
  extends: ["@commitlint/config-conventional"],
  helpUrl: "docs/agents/workflow.md, The commit's form",
  plugins: [
    {
      rules: {
        "header-names-no-ticket": ({ header }) => [
          !TICKET.test(header ?? ""),
          "header may not name a ticket; put it in a `Refs: T-nnn` footer",
        ],
      },
    },
  ],
  rules: {
    "header-max-length": [2, "always", 72],
    "header-names-no-ticket": [2, "always"],
    // commitlint exempts a name in backticks or quotes, so `OKF` keeps its capitals.
    "subject-case": [2, "always", "lower-case"],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "test", "refactor", "perf", "build", "ci", "chore", "revert"],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "api",
        "web",
        "worker",
        "core",
        "schema",
        "devtools",
        "design-system",
        "deploy",
        "ci",
        "docs",
        "auth",
        "people",
        "ops",
        // Renovate's, for its `chore(deps)` subjects.
        "deps",
      ],
    ],
    // A body paragraph is one line, however long.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
