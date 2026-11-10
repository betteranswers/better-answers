export const REASON_MAX_CHARACTERS = 1_000;

export const SHORT_NAME_EXAMPLE = "acme-joinery";

export const ASK_TO_JOIN_WORDS = {
  heading: "Ask to join a workspace",
  shortName: "Workspace short name",
  forExample: "For example,",
  reason: "Reason",
  reasonHint: `Shown to the workspace’s Admins. Up to ${REASON_MAX_CHARACTERS.toLocaleString("en-GB")} characters.`,
  ask: "Ask to join",
  asking: "Asking",
  sent: "Request sent",
  whatHappensNext: "You’ll get an email if an Admin approves it.",
} as const;
