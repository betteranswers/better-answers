import { defineRule } from "@oxlint/plugins";
import type { Node } from "@oxlint/plugins";

import { citationIn } from "../../src/comments/citations.ts";

const A_SPACE = /\s/u;

const A_TEST_PATH = /(?:^|\/)(?:tests?|e2e)\/|\.test\.[cm]?tsx?$/u;

const readsAsATest = (filename: string): boolean =>
  A_TEST_PATH.test(filename.replaceAll("\\", "/"));

export const stringCitesNothingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A string that a person reads says what they can act on, in words that make sense without another document. Tests are exempt.",
    },
    messages: {
      cites:
        "This string cites {{what}} (`{{cited}}`), which the reader cannot open from where they read the string. Say what the reader needs to know or do instead.",
    },
  },
  createOnce(context) {
    const refuseCitation = (node: Node, text: string): void => {
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
