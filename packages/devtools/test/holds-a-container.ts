import { GenericContainer } from "testcontainers";

import { POSTGRES_IMAGE } from "@better-answers/schema";

const started = await new GenericContainer(POSTGRES_IMAGE)
  .withCommand(["sleep", "infinity"])
  .start();

process.stdout.write(`${started.getId()}\n`);

// testcontainers unrefs its socket to Ryuk, so nothing else keeps this process alive until killed.
setInterval(() => undefined, 60_000);
