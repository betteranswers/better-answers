import { commentInventory } from "../packages/devtools/src/comments/comment-inventory.ts";

process.exitCode = commentInventory(process.argv.slice(2));
