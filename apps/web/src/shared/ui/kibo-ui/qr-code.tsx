import QR from "qrcode";
import { type HTMLAttributes, useEffect, useState } from "react";

import { cn } from "@/shared/lib/utils.ts";

export type QRCodeProps = HTMLAttributes<HTMLDivElement> & {
  data: string;
  foreground?: string;
  background?: string;
  robustness?: "L" | "M" | "Q" | "H";
};

/** The tokens resolve to plain colours at the root, which the encoder takes as they are. */
const tokenOf = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
            dark: foreground ?? tokenOf("--foreground"),
            light: background ?? tokenOf("--background"),
          },
          width: 200,
          errorCorrectionLevel: robustness,
          margin: 0,
        });

        setSVG(newSvg);
      } catch {
        // Nothing is drawn: the caller shows the same data as text beside the code.
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
