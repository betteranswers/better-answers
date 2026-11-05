import { GenericContainer } from "testcontainers";

import { POSTGRES_IMAGE } from "@better-answers/schema";

const started = await new GenericContainer(POSTGRES_IMAGE)
  .withCommand(["sleep", "infinity"])
  .start();

process.stdout.write(`${started.getId()}\n`);

// testcontainers unrefs its Ryuk socket, so this timer keeps the process alive until it is killed.
setInterval(() => undefined, 60_000);
