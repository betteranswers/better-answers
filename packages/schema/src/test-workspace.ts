/** The journeys' test workspace as the fixture command makes it and the journeys check it. */
export const INVENTED_MEMBERS = 51;

/** Numbered from 01, so a list in address order is in number order. */
export const inventedMemberAddress = (number: number, domain: string): string =>
  `invented-member-${String(number).padStart(2, "0")}@${domain}`;
