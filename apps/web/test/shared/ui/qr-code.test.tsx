import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QRCode } from "@/shared/ui/kibo-ui/qr-code.tsx";

afterEach(cleanup);

const ADDRESS = "otpauth://totp/better-answers:ada%40example.test?secret=JBSWY3DPEHPK3PXP";

const renderedWith = async (foreground: string) => {
  const { container } = render(<QRCode data={ADDRESS} foreground={foreground} />);
  await waitFor(() => {
    expect(container.querySelector("svg")).not.toBeNull();
  });
  return container;
};

describe("QRCode", () => {
  it("renders a hex colour unchanged", async () => {
    const container = await renderedWith("#123456");

    expect(container.innerHTML).toContain('stroke="#123456"');
  });

  it("falls back to black when the colour contains markup", async () => {
    const container = await renderedWith('#"/><i>');

    expect(container.querySelector("i")).toBeNull();
    expect(container.innerHTML).toContain('stroke="#000000"');
  });
});
