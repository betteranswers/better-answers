/**
 * The api's rule holds the limit. Stated rather than imported, because the schema module holding
 * it would bring its table definitions into the bundle.
 */
export const REASON_MAX_CHARACTERS = 1_000;

export const SHORT_NAME_EXAMPLE = "acme-joinery";

export const ASK_TO_JOIN_WORDS = {
  heading: "Ask to Join a Workspace",
  shortName: "Workspace Short Name",
  forExample: "For example,",
  reason: "Reason",
  reasonHint: `This will be visible to the workspace’s Admins. Must be ${REASON_MAX_CHARACTERS.toLocaleString("en-GB")} characters or fewer.`,
  ask: "Ask to Join",
  asking: "Asking",
  sent: "Request sent",
  whatHappensNext:
    "If that workspace exists, its Admins will review your request. You’ll get an email if it’s approved.",
} as const;
