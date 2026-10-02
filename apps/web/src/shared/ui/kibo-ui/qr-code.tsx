import QR from "qrcode";
import { type HTMLAttributes, useEffect, useState } from "react";

import { cn } from "@/shared/lib/utils.ts";

export type QRCodeProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "dangerouslySetInnerHTML"
> & {
  data: string;
  foreground?: string;
  background?: string;
  robustness?: "L" | "M" | "Q" | "H";
};

/** The encoder writes a colour into its SVG unescaped, and the SVG is set as HTML. */
const HEX_COLOUR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

/** The tokens resolve to plain colours at the root, which the encoder takes as they are. */
const tokenOf = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const hexOr = (colours: readonly (string | undefined)[], fallback: string): string =>
  colours.find((colour) => colour !== undefined && HEX_COLOUR.test(colour)) ?? fallback;

export const QRCode = ({
  data,
  foreground,
  background,
  robustness = "M",
  className,
  ...props
}: QRCodeProps) => {
  const [svg, setSVG] = useState<string | null>(null);

  useEffect(() => {
    const generateQR = async () => {
      try {
        const newSvg = await QR.toString(data, {
          type: "svg",
          color: {
            dark: hexOr([foreground, tokenOf("--foreground")], "#000000"),
            light: hexOr([background, tokenOf("--background")], "#ffffff"),
          },
          width: 200,
          errorCorrectionLevel: robustness,
          margin: 4,
        });

        setSVG(newSvg);
      } catch {
        // Nothing is drawn: the caller writes the key out as text beside the code.
      }
    };

    void generateQR();
  }, [data, foreground, background, robustness]);

  if (!svg) {
    return null;
  }

  return (
    <div
      className={cn("size-full", "[&_svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
      {...props}
    />
  );
};
