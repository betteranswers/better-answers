import { commentInventory } from "../packages/devtools/src/comment-inventory.ts";

process.exitCode = commentInventory(process.argv.slice(2));
