import { createContext, useCallback, useContext } from "react";

export type NoticeClaim = HTMLElement | "held";

export const NoticeSlotChoice = createContext<(claim: NoticeClaim | null) => void>(() => {});

export function NoticeBelowTheTitle() {
  const choose = useContext(NoticeSlotChoice);
  return <div ref={choose} />;
}

export function NoticeHeld() {
  const choose = useContext(NoticeSlotChoice);
  const hold = useCallback(
    (node: HTMLSpanElement | null) => {
      choose(node === null ? null : "held");
    },
    [choose],
  );
  return <span hidden ref={hold} />;
}
