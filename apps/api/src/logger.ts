import { pino } from "pino";

/**
 * The tier's one structured logger: JSON to stdout, `console.*` banned.
 * Prompt and completion content never reach it.
 */
export const logger = pino();
