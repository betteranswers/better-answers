/**
 * The scroll-reveal seam the canvas uses: a tile fades in over 240ms and rises 4px, once.
 *
 * The register allows fades of 80–240ms and a 4px rise and nothing else — no lift, no scale
 * — and `prefers-reduced-motion` is honoured by never arming the observer, so a reduced
 * reader gets the finished state on first paint rather than a one-frame animation.
 */
import { useEffect, useRef, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(REDUCED).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(REDUCED);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return { ref, shown } as const;
}
