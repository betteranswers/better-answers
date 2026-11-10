import { useEffect, useState } from "react";

const READING_OFFSET = 80;

export const currentOf = (tops: readonly number[], line: number, atEnd: boolean): number =>
  atEnd
    ? Math.max(tops.length - 1, 0)
    : Math.max(
        tops.findLastIndex((top) => top <= line),
        0,
      );

const readingLine = (): number =>
  (Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--band-drawn-h"),
  ) || 0) + READING_OFFSET;

const atEndOfPage = (): boolean =>
  window.scrollY > 0 &&
  window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;

const topOf = (id: string): number =>
  document.getElementById(id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;

export function useCurrentSection(ids: readonly string[]): string | undefined {
  const [at, setAt] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setAt(currentOf(ids.map(topOf), readingLine(), atEndOfPage()));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    schedule();
    const resized = new ResizeObserver(schedule);
    resized.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("scroll", schedule);
    };
  }, [ids]);
  return ids[at];
}
