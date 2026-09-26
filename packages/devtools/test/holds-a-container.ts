import { POSTGRES_IMAGE } from "@better-answers/schema";
import { GenericContainer } from "testcontainers";

// The pinned image every suite already pulls; `sleep` holds it without starting Postgres.
const started = await new GenericContainer(POSTGRES_IMAGE)
  .withCommand(["sleep", "infinity"])
  .start();

process.stdout.write(`${started.getId()}\n`);

// testcontainers unrefs its socket to Ryuk, so nothing else keeps this process alive until killed.
setInterval(() => undefined, 60_000);
