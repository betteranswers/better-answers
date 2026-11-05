import { defineRule } from "@oxlint/plugins";

export const importStaticallyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Source code imports modules statically. Only tests and scripts may use a dynamic `import()`.",
    },
    messages: {
      dynamic:
        "A dynamic `import()` hides a dependency from every tool that reads the module graph. Import the module statically, at the top of the file.",
    },
  },
  createOnce(context) {
    return {
      ImportExpression(node) {
        context.report({ node, messageId: "dynamic" });
      },
    };
  },
});
