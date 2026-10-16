import { defineRule } from "@oxlint/plugins";

export const importStaticallyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Source imports statically; a dynamic `import()` is left to tests and scripts.",
    },
    messages: {
      dynamic:
        "A dynamic `import()` hides a dependency from every tool that reads the module graph. Import the module statically, at the top of the file",
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
