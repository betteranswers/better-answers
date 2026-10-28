import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QRCode } from "@/shared/ui/kibo-ui/qr-code.tsx";

afterEach(cleanup);

const ADDRESS = "otpauth://totp/better-answers:ada%40example.test?secret=JBSWY3DPEHPK3PXP";

const drawnWith = async (foreground: string) => {
  const { container } = render(<QRCode data={ADDRESS} foreground={foreground} />);
  await waitFor(() => {
    expect(container.querySelector("svg")).not.toBeNull();
  });
  return container;
};

describe("QRCode", () => {
  it("draws a hex colour as given", async () => {
    const drawn = await drawnWith("#123456");

    expect(drawn.innerHTML).toContain('stroke="#123456"');
  });

  it("draws no markup a colour carries", async () => {
    const drawn = await drawnWith('#"/><i>');

    expect(drawn.querySelector("i")).toBeNull();
    expect(drawn.innerHTML).toContain('stroke="#000000"');
  });
});
