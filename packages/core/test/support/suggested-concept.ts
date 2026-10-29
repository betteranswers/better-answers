import { head } from "@better-answers/core/store/git";

import {
  submitSuggestionSet,
  writeConcept,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { doorsOf, type Scenario } from "../fixtures/workspace-with-bundle.ts";

let written = 0;

export const nextConcept = (): number => {
  written += 1;
  return written;
};

export const conceptWritten = async (
  scenario: Scenario,
  overrides: Partial<WriteConceptInput> = {},
) => {
  const n = nextConcept();
  const input: WriteConceptInput = {
    mergeKey: `policy:expenses-${n}`,
    path: `knowledge/policy/expenses-${n}.md`,
    kind: "Policy",
    title: "Expenses",
    frontmatter: { title: "Expenses", type: "Policy" },
    body: "Expenses are claimed within thirty days.",
    message: "Record the expenses policy",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(scenario.admin, scenario.git) },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
  };
  const wrote = await writeConcept(scenario.admin, doorsOf(scenario), input);
  if (!wrote.ok) throw new Error(`the write was refused: ${String(wrote.error)}`);
  return { input, written: wrote.value };
};

export const proposedBy = async (
  scenario: Scenario,
  proposer: UserPrincipal,
  standing: Awaited<ReturnType<typeof conceptWritten>>,
  proposes: Partial<SuggestionRequest> = {},
) => {
  const set = await submitSuggestionSet(
    proposer,
    { postgres: scenario.postgres },
    {
      kind: "edit",
      requests: [
        {
          mergeKey: standing.input.mergeKey,
          path: standing.input.path,
          conceptKind: "Policy",
          title: "Expenses",
          frontmatter: { title: "Expenses", type: "Policy" },
          body: "Expenses are claimed within sixty days.",
          baseContentHash: standing.written.contentHash,
          ...proposes,
        },
      ],
    },
  );
  if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
  return {
    setId: set.value.setId,
    suggestionId: set.value.suggestionIds[0] ?? "",
  };
};

export const conceptProposedBy = async (
  scenario: Scenario,
  proposer: UserPrincipal,
  wrote: Partial<WriteConceptInput> = {},
) => {
  const standing = await conceptWritten(scenario, wrote);
  return { ...standing, ...(await proposedBy(scenario, proposer, standing)) };
};
