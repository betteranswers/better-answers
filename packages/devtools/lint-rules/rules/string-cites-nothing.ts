import { defineRule } from "@oxlint/plugins";

import { citationIn } from "../../src/citations.ts";
import { stringsGoUnread } from "../../src/tag-printing-gates.ts";

import type { Node } from "@oxlint/plugins";

const A_SPACE = /\s/;

export const stringCitesNothingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "A string a person reads cites no ticket, date, rule tag or ADR number. Tests, and gates that print their own tag, are exempt.",
    },
    messages: {
      cites:
        "This string cites {{what}} (`{{cited}}`); a string that reaches a person names what they can act on, never a document they cannot open from where they read it ([COMMENT1]). Say the thing instead.",
    },
  },
  createOnce(context) {
    const refuseCitation = (node: Node, text: string): void => {
      // A string with no space in it is an identifier, a path, a key or a version: a value,
      // not something a person reads.
      if (!A_SPACE.test(text) || stringsGoUnread(context.filename)) return;
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
