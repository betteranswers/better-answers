export const INVENTED_MEMBERS = 51;

export const inventedMemberAddress = (number: number, domain: string): string =>
  `invented-member-${String(number).padStart(2, "0")}@${domain}`;
