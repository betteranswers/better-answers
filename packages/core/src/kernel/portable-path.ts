export const isPortablePath = (candidate: string): boolean =>
  !candidate.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }) &&
  candidate.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
