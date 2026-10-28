import { describe, expect, it } from "vitest";

import { passkeyNameFor } from "@/features/auth/account-words.ts";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0";

describe("suggesting a passkey's name", () => {
  it.each([
    ["Chrome on macOS", MAC_CHROME],
    ["Safari on iOS", IPHONE_SAFARI],
    ["Edge on Windows", WINDOWS_EDGE],
    ["Chrome on Android", ANDROID_CHROME],
    ["Firefox on Linux", LINUX_FIREFOX],
  ])("reads %s from its user agent", (name, userAgent) => {
    expect(passkeyNameFor(userAgent)).toBe(name);
  });

  it("falls back to Passkey for an unknown browser", () => {
    expect(passkeyNameFor("curl/8.9.1")).toBe("Passkey");
  });
});
