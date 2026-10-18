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
        The page lands
      </button>
    </>
  );
}

const searchBox = (): HTMLElement => screen.getByRole("searchbox", { name: "Search" });

const askedForMore = (): void => {
  const more = screen.getByRole("button", { name: "Load More" });
  more.focus();
  fireEvent.click(more);
};

const thePageLands = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "The page lands" }));
};

describe("where focus goes when Load More's page lands", () => {
  it("lands on the first new line", () => {
    render(<Lines />);

    askedForMore();
    thePageLands();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("lands there when focus has fallen to the page", () => {
    render(<Lines />);

    askedForMore();
    screen.getByRole("button", { name: "Load More" }).blur();
    thePageLands();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("leaves focus where the reader has since moved it", () => {
    render(<Lines />);

    askedForMore();
    searchBox().focus();
    thePageLands();

    expect(document.activeElement).toBe(searchBox());
  });

  it("lands when the window comes back to the same control", () => {
    render(<Lines />);

    askedForMore();
    fireEvent.focusIn(screen.getByRole("button", { name: "Load More" }));
    thePageLands();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("lands again on the next page asked for", () => {
    render(<Lines />);

    askedForMore();
    searchBox().focus();
    thePageLands();
    askedForMore();
    thePageLands();

    expect(document.activeElement?.textContent).toBe("line 5");
  });
});
