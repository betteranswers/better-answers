import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";

let mounted = 0;

const Mounted = () => {
  useEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
    };
  }, []);
  return <button type="button">mounted</button>;
};

describe("the shared setup", () => {
  it("unmounts the first rendered tree after its test", () => {
    render(<Mounted />);

    expect(mounted).toBe(1);
  });

  it("unmounts the second rendered tree after its test", () => {
    render(<Mounted />);

    expect(mounted).toBe(1);
  });
});
