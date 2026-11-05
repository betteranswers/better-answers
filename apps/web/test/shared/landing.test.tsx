import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useLanding, useLandingLine } from "@/shared/landing.ts";

afterEach(cleanup);

function Line(properties: {
  readonly name: string;
  readonly landsHere: boolean;
  readonly onLanded: () => void;
}) {
  const land = useLandingLine(properties.landsHere, properties.onLanded);
  return (
    <li ref={land} tabIndex={-1}>
      {properties.name}
    </li>
  );
}

function Lines() {
  const [lines, setLines] = useState(["line 1", "line 2"]);
  const landing = useLanding();
  return (
    <>
      <input type="search" aria-label="Search" />
      <ol>
        {lines.map((name, index) => (
          <Line
            key={name}
            name={name}
            landsHere={index === landing.landAt}
            onLanded={landing.landed}
          />
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          landing.landOn(lines.length);
        }}
      >
        Load More
      </button>
      <button
        type="button"
        onClick={() => {
          setLines([
            ...lines,
            `line ${String(lines.length + 1)}`,
            `line ${String(lines.length + 2)}`,
          ]);
        }}
      >
        Add Lines
      </button>
    </>
  );
}

const searchBox = (): HTMLElement => screen.getByRole("searchbox", { name: "Search" });

const clickLoadMore = (): void => {
  const more = screen.getByRole("button", { name: "Load More" });
  more.focus();
  fireEvent.click(more);
};

const addNextPage = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Add Lines" }));
};

describe("focus after Load More adds rows", () => {
  it("moves to the first new line", () => {
    render(<Lines />);

    clickLoadMore();
    addNextPage();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("moves to the first new line after focus is lost", () => {
    render(<Lines />);

    clickLoadMore();
    screen.getByRole("button", { name: "Load More" }).blur();
    addNextPage();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("stays where the user moved it while loading", () => {
    render(<Lines />);

    clickLoadMore();
    searchBox().focus();
    addNextPage();

    expect(document.activeElement).toBe(searchBox());
  });

  it("moves to the new line after the window regains focus", () => {
    render(<Lines />);

    clickLoadMore();
    fireEvent.focusIn(screen.getByRole("button", { name: "Load More" }));
    addNextPage();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("moves to the first line of the next page too", () => {
    render(<Lines />);

    clickLoadMore();
    searchBox().focus();
    addNextPage();
    clickLoadMore();
    addNextPage();

    expect(document.activeElement?.textContent).toBe("line 5");
  });
});
