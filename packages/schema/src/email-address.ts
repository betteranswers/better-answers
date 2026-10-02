import { z } from "zod";

/** Longer than any address a mail system delivers to, so a real one is never refused. */
export const EMAIL_ADDRESS = z.email().max(254);
