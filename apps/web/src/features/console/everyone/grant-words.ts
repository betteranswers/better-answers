import { byWords, type DoneBy } from "@/shared/words.ts";

const ENDED_BY_THE_SERVER = "The person’s session ending, or the assistant disconnecting";

type EndedBy = DoneBy | { readonly kind: "authorization-server" };

export const endedByWords = (by: EndedBy): string =>
  by.kind === "authorization-server" ? ENDED_BY_THE_SERVER : byWords(by);
