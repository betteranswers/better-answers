import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CountedSwitch, type CountedChoice } from "@/shared/ui/kibo-ui/counted-switch.tsx";

afterEach(cleanup);

const NOTHING = () => undefined;

const switchOf = (choices: readonly CountedChoice[]) => {
  render(
    <CountedSwitch label="Status" value="waiting" choices={choices} onValueChange={NOTHING} />,
  );
};

describe("a counted switch", () => {
  it("leaves out an unread count rather than saying 0", () => {
    switchOf([{ value: "waiting", label: "Waiting", count: undefined }]);

    const choice = screen.getByRole("radio", { name: "Waiting" });
    expect(choice).toHaveProperty("textContent", "Waiting");
  });

  it("shows a count of 0 as 0", () => {
    switchOf([{ value: "accepted", label: "Accepted", count: 0 }]);

    expect(screen.getByRole("radio", { name: "Accepted 0" })).toHaveProperty(
      "textContent",
      "Accepted 0",
    );
  });
});
