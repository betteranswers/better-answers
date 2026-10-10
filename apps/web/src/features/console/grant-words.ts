import { byWords, type DoneBy } from "@/shared/words.ts";

/** The authorization server's mark says the grant ended, never which of the two ended it. */
export const ENDED_BY_THE_SERVER = "The person’s session ending, or the assistant disconnecting";

/** Who ended an assistant's access: an action's actor, or the authorization server on its own. */
type EndedBy = DoneBy | { readonly kind: "authorization-server" };

export const endedByWords = (by: EndedBy): string =>
  by.kind === "authorization-server" ? ENDED_BY_THE_SERVER : byWords(by);
