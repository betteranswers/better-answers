/**
 * The api's rule holds the limit. Stated rather than imported, because the schema module holding
 * it would bring its table definitions into the bundle.
 */
export const REASON_MAX_CHARACTERS = 1_000;

export const SLUG_EXAMPLE = "acme-joinery";

/** A reader meets a slug as a short name: the glossary's word is not one they need. */
export const ASK_TO_JOIN_WORDS = {
  heading: "Ask to join a workspace",
  slug: "Workspace short name",
  forExample: "For example,",
  reason: "Why you are asking",
  reasonHint: `The workspace's Admins read this. Up to ${REASON_MAX_CHARACTERS.toLocaleString("en-GB")} characters.`,
  ask: "Ask to join",
  asking: "Asking",
  sent: "Request sent",
  /** One sentence for every slug, so the answer can't tell a customer from a stranger. */
  whatHappensNext:
    "If that workspace exists, its Admins will see your request. You'll get an invitation by email if one approves.",
} as const;
