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

/** Two lines, a box to move focus to, and a page of two more that lands when it is told to. */
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
        Load more
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
  const more = screen.getByRole("button", { name: "Load more" });
  more.focus();
  fireEvent.click(more);
};

/** A click fired, not pressed: a press would move focus, and the page lands under whatever holds it. */
const thePageLands = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "The page lands" }));
};

describe("where focus goes when Load more's page lands", () => {
  it("lands on the first new line", () => {
    render(<Lines />);

    askedForMore();
    thePageLands();

    expect(document.activeElement?.textContent).toBe("line 3");
  });

  it("lands there when focus has fallen to the page", () => {
    render(<Lines />);

    askedForMore();
    screen.getByRole("button", { name: "Load more" }).blur();
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
