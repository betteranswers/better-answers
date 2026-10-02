import { defineRule } from "@oxlint/plugins";
import type { Node } from "@oxlint/plugins";

import { citationIn } from "../../src/citations.ts";

const A_SPACE = /\s/;

const A_TEST_PATH = /(?:^|\/)(?:tests?|e2e)\/|\.test\.[cm]?tsx?$/;

const readsAsATest = (filename: string): boolean =>
  A_TEST_PATH.test(filename.replaceAll("\\", "/"));

export const stringCitesNothingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A string a person reads names what they can act on, in words that stand on their own (the root `CODING_STANDARDS.md`). A test is exempt.",
    },
    messages: {
      cites:
        "This string cites {{what}} (`{{cited}}`); a string that reaches a person names what they can act on, never a document they cannot open from where they read it (the root `CODING_STANDARDS.md`). Say the thing instead.",
    },
  },
  createOnce(context) {
    const refuseCitation = (node: Node, text: string): void => {
      // A string with no space in it is an identifier, a path, a key or a version: a value,
      // not something a person reads.
      if (!A_SPACE.test(text) || readsAsATest(context.filename)) return;
      const cited = citationIn(text);
      if (cited === undefined) return;
      context.report({ node, messageId: "cites", data: { ...cited } });
    };

    return {
      Literal(node): void {
        if (typeof node.value === "string") refuseCitation(node, node.value);
      },
      TemplateLiteral(node): void {
        for (const quasi of node.quasis) {
          refuseCitation(quasi, quasi.value.cooked ?? quasi.value.raw);
        }
      },
    };
  },
});
